// ─────────────────────────────────────────────────────────────────────────────
// authorProfile.test.ts - Unit tests for author profile functions
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  isValidBAI,
  extractAuthorSearchInfos,
} from "../src/modules/inspire/authorUtils";
import { parseAuthorProfile } from "../src/modules/inspire/authorProfileService";

// ─────────────────────────────────────────────────────────────────────────────
// isValidBAI - BAI format validation
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidBAI", () => {
  describe("valid BAI formats", () => {
    it('accepts standard BAI format "First.Last.Number"', () => {
      expect(isValidBAI("Feng.Kun.Guo.1")).toBe(true);
      expect(isValidBAI("E.Witten.1")).toBe(true);
      expect(isValidBAI("R.L.Jaffe.1")).toBe(true);
    });

    it("accepts BAI with single letter parts", () => {
      expect(isValidBAI("A.B.Smith.1")).toBe(true);
      expect(isValidBAI("X.Y.Z.Chen.2")).toBe(true);
    });

    it("accepts BAI with multi-digit disambiguation number", () => {
      expect(isValidBAI("John.Smith.12")).toBe(true);
      expect(isValidBAI("Jane.Doe.100")).toBe(true);
    });

    it("accepts BAI with mixed case", () => {
      expect(isValidBAI("feng.kun.guo.1")).toBe(true);
      expect(isValidBAI("FENG.KUN.GUO.1")).toBe(true);
    });
  });

  describe("invalid BAI formats", () => {
    it("rejects empty or non-string input", () => {
      expect(isValidBAI("")).toBe(false);
      expect(isValidBAI(null as any)).toBe(false);
      expect(isValidBAI(undefined as any)).toBe(false);
      expect(isValidBAI(123 as any)).toBe(false);
    });

    it("rejects BAI without dots", () => {
      expect(isValidBAI("FengKunGuo1")).toBe(false);
      expect(isValidBAI("invalid")).toBe(false);
    });

    it("rejects BAI without ending number", () => {
      expect(isValidBAI("Feng.Kun.Guo")).toBe(false);
      expect(isValidBAI("E.Witten.abc")).toBe(false);
    });

    it("rejects BAI with only numbers", () => {
      expect(isValidBAI("123.456.789.1")).toBe(false);
      expect(isValidBAI("1.2.3")).toBe(false);
    });

    it("rejects BAI with less than 2 parts", () => {
      expect(isValidBAI("Witten")).toBe(false);
      expect(isValidBAI("1")).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractAuthorSearchInfos - Author info extraction
// ─────────────────────────────────────────────────────────────────────────────

describe("extractAuthorSearchInfos", () => {
  describe("basic extraction", () => {
    it("extracts fullName from authors array", () => {
      const authors = [
        { full_name: "Guo, Feng-Kun" },
        { full_name: "Witten, Edward" },
      ];
      const result = extractAuthorSearchInfos(authors);
      expect(result).toHaveLength(2);
      expect(result?.[0].fullName).toBe("Guo, Feng-Kun");
      expect(result?.[1].fullName).toBe("Witten, Edward");
    });

    it("extracts BAI from ids array", () => {
      const authors = [
        {
          full_name: "Guo, Feng-Kun",
          ids: [{ schema: "INSPIRE BAI", value: "Feng.Kun.Guo.1" }],
        },
      ];
      const result = extractAuthorSearchInfos(authors);
      expect(result?.[0].bai).toBe("Feng.Kun.Guo.1");
    });

    it("extracts recid from author.recid", () => {
      const authors = [{ full_name: "Witten, Edward", recid: 1012345 }];
      const result = extractAuthorSearchInfos(authors);
      expect(result?.[0].recid).toBe("1012345");
    });

    it("extracts recid from author.record.$ref", () => {
      const authors = [
        {
          full_name: "Witten, Edward",
          record: { $ref: "https://inspirehep.net/api/authors/1012345" },
        },
      ];
      const result = extractAuthorSearchInfos(authors);
      expect(result?.[0].recid).toBe("1012345");
    });
  });

  describe("edge cases", () => {
    it("returns undefined for empty array", () => {
      expect(extractAuthorSearchInfos([])).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(extractAuthorSearchInfos(undefined)).toBeUndefined();
    });

    it("maintains index alignment with placeholder for missing names", () => {
      const authors = [
        { full_name: "Author One" },
        { name_only: "no full_name field" }, // Missing full_name
        { full_name: "Author Three" },
      ];
      const result = extractAuthorSearchInfos(authors);
      expect(result).toHaveLength(3);
      expect(result?.[0].fullName).toBe("Author One");
      expect(result?.[1].fullName).toBe(""); // Placeholder
      expect(result?.[2].fullName).toBe("Author Three");
    });

    it("validates BAI format before extracting", () => {
      const authors = [
        {
          full_name: "Test Author",
          ids: [{ schema: "INSPIRE BAI", value: "invalid-bai" }],
        },
      ];
      const result = extractAuthorSearchInfos(authors);
      expect(result?.[0].bai).toBeUndefined(); // Invalid BAI should be ignored
    });

    it("respects extraction limit", () => {
      const authors = Array.from({ length: 20 }, (_, i) => ({
        full_name: `Author ${i}`,
      }));
      const result = extractAuthorSearchInfos(authors, 5);
      expect(result).toHaveLength(5);
    });
  });

  describe("unicode support", () => {
    it("extracts full_name_unicode_normalized as fallback", () => {
      const authors = [{ full_name_unicode_normalized: "Müller, Hans" }];
      const result = extractAuthorSearchInfos(authors);
      expect(result?.[0].fullName).toBe("Müller, Hans");
    });

    it("prefers full_name over unicode normalized", () => {
      const authors = [
        {
          full_name: "Mueller, Hans",
          full_name_unicode_normalized: "Müller, Hans",
        },
      ];
      const result = extractAuthorSearchInfos(authors);
      expect(result?.[0].fullName).toBe("Mueller, Hans");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseAuthorProfile - Profile parsing from INSPIRE API response
// ─────────────────────────────────────────────────────────────────────────────

describe("parseAuthorProfile", () => {
  describe("basic parsing", () => {
    it("parses name from metadata", () => {
      const metadata = {
        name: { preferred_name: "Feng-Kun Guo", value: "Guo, Feng-Kun" },
      };
      const result = parseAuthorProfile(metadata, "1234567");
      expect(result?.name).toBe("Feng-Kun Guo");
      expect(result?.recid).toBe("1234567");
    });

    it("falls back to name.value if preferred_name is missing", () => {
      const metadata = {
        name: { value: "Guo, Feng-Kun" },
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.name).toBe("Guo, Feng-Kun");
    });

    it("returns null if name is missing", () => {
      const metadata = { positions: [] };
      expect(parseAuthorProfile(metadata)).toBeNull();
    });
  });

  describe("position extraction", () => {
    it("extracts current position", () => {
      const metadata = {
        name: { value: "Test Author" },
        positions: [
          { institution: "Old University", current: false },
          { institution: "Current University", rank: "Professor", current: true },
        ],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.currentPosition?.institution).toBe("Current University");
      expect(result?.currentPosition?.rank).toBe("Professor");
    });

    it("falls back to first position if no current", () => {
      const metadata = {
        name: { value: "Test Author" },
        positions: [{ institution: "First University", rank: "Postdoc" }],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.currentPosition?.institution).toBe("First University");
    });
  });

  describe("ID extraction", () => {
    it("extracts ORCID", () => {
      const metadata = {
        name: { value: "Test" },
        ids: [{ schema: "ORCID", value: "0000-0001-2345-6789" }],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.orcid).toBe("0000-0001-2345-6789");
    });

    it("extracts INSPIRE BAI", () => {
      const metadata = {
        name: { value: "Test" },
        ids: [{ schema: "INSPIRE BAI", value: "Test.Author.1" }],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.bai).toBe("Test.Author.1");
    });

    it("extracts INSPIRE ID", () => {
      const metadata = {
        name: { value: "Test" },
        ids: [{ schema: "INSPIRE ID", value: "INSPIRE-12345" }],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.inspireId).toBe("INSPIRE-12345");
    });
  });

  describe("email extraction", () => {
    it("extracts current emails", () => {
      const metadata = {
        name: { value: "Test" },
        email_addresses: [
          { value: "old@example.com", current: false },
          { value: "current@example.com", current: true },
        ],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.emails).toEqual(["current@example.com"]);
    });

    it("falls back to all emails if no current", () => {
      const metadata = {
        name: { value: "Test" },
        email_addresses: [
          { value: "email1@example.com" },
          { value: "email2@example.com" },
        ],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.emails).toHaveLength(2);
    });

    it("filters out invalid email values", () => {
      const metadata = {
        name: { value: "Test" },
        email_addresses: [
          { value: "valid@example.com" },
          { value: "" },
          { value: null },
          { value: "  " },
        ],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.emails).toEqual(["valid@example.com"]);
    });
  });

  describe("optional fields", () => {
    it("extracts arxiv categories", () => {
      const metadata = {
        name: { value: "Test" },
        arxiv_categories: ["hep-ph", "hep-th"],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.arxivCategories).toEqual(["hep-ph", "hep-th"]);
    });

    it("extracts homepage URL", () => {
      const metadata = {
        name: { value: "Test" },
        urls: [{ value: "https://example.com/~author" }],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.homepageUrl).toBe("https://example.com/~author");
    });

    it("extracts advisors", () => {
      const metadata = {
        name: { value: "Test" },
        advisors: [
          { name: "Advisor One", degree_type: "phd" },
          { name: "Advisor Two", degree_type: "master" },
        ],
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.advisors).toHaveLength(2);
      expect(result?.advisors?.[0].name).toBe("Advisor One");
      expect(result?.advisors?.[0].degreeType).toBe("phd");
    });

    it("extracts status", () => {
      const metadata = {
        name: { value: "Test" },
        status: "active",
      };
      const result = parseAuthorProfile(metadata);
      expect(result?.status).toBe("active");
    });
  });
});
