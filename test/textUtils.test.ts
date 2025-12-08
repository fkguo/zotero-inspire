// ─────────────────────────────────────────────────────────────────────────────
// textUtils.test.ts - Unit tests for text normalization and filtering
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  normalizeSearchText,
  buildVariantSet,
  buildSearchIndexText,
  parseFilterTokens,
  buildFilterTokenVariants,
} from "../src/modules/inspire/textUtils";

describe("normalizeSearchText", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeSearchText("")).toBe("");
    expect(normalizeSearchText(null as unknown as string)).toBe("");
    expect(normalizeSearchText(undefined as unknown as string)).toBe("");
  });

  it("converts to lowercase", () => {
    expect(normalizeSearchText("Hello World")).toBe("hello world");
    expect(normalizeSearchText("UPPERCASE")).toBe("uppercase");
  });

  it("replaces special characters", () => {
    expect(normalizeSearchText("ß")).toBe("ss");
    expect(normalizeSearchText("æ")).toBe("ae");
    expect(normalizeSearchText("œ")).toBe("oe");
    expect(normalizeSearchText("ø")).toBe("o");
    expect(normalizeSearchText("đ")).toBe("d");
    expect(normalizeSearchText("ð")).toBe("d");
    expect(normalizeSearchText("þ")).toBe("th");
    expect(normalizeSearchText("ł")).toBe("l");
  });

  it("removes diacritics", () => {
    expect(normalizeSearchText("café")).toBe("cafe");
    expect(normalizeSearchText("naïve")).toBe("naive");
    expect(normalizeSearchText("résumé")).toBe("resume");
    expect(normalizeSearchText("Müller")).toBe("muller");
    expect(normalizeSearchText("Schröder")).toBe("schroder");
  });

  it("handles mixed special characters and diacritics", () => {
    expect(normalizeSearchText("Grüß Gott")).toBe("gruss gott");
    expect(normalizeSearchText("Æther")).toBe("aether");
  });
});

describe("buildVariantSet", () => {
  it("returns empty array for empty input", () => {
    expect(buildVariantSet("")).toEqual([]);
    expect(buildVariantSet(null as unknown as string)).toEqual([]);
  });

  it("returns single variant for simple text", () => {
    const result = buildVariantSet("hello");
    expect(result).toContain("hello");
    expect(result.length).toBe(1);
  });

  it("expands German umlauts to ae/oe/ue variants", () => {
    const result = buildVariantSet("Müller");
    expect(result).toContain("muller");
    expect(result).toContain("mueller");
    expect(result.length).toBe(2);
  });

  it("handles ä, ö, ü expansions", () => {
    const result = buildVariantSet("Schäfer");
    expect(result).toContain("schafer");
    expect(result).toContain("schaefer");
  });

  it("deduplicates identical variants", () => {
    const result = buildVariantSet("test");
    const unique = [...new Set(result)];
    expect(result.length).toBe(unique.length);
  });
});

describe("buildSearchIndexText", () => {
  it("joins variants with space", () => {
    const result = buildSearchIndexText("Müller");
    expect(result).toContain("muller");
    expect(result).toContain("mueller");
    expect(result.split(" ").length).toBe(2);
  });

  it("returns empty string for empty input", () => {
    expect(buildSearchIndexText("")).toBe("");
  });
});

describe("parseFilterTokens", () => {
  it("returns empty array for empty input", () => {
    expect(parseFilterTokens("")).toEqual([]);
    expect(parseFilterTokens(null as unknown as string)).toEqual([]);
  });

  it("parses single unquoted token", () => {
    const result = parseFilterTokens("hello");
    expect(result).toEqual([{ text: "hello", quoted: false }]);
  });

  it("parses multiple space-separated tokens", () => {
    const result = parseFilterTokens("hello world");
    expect(result).toEqual([
      { text: "hello", quoted: false },
      { text: "world", quoted: false },
    ]);
  });

  it("handles quoted strings as single token", () => {
    const result = parseFilterTokens('"hello world"');
    expect(result).toEqual([{ text: "hello world", quoted: true }]);
  });

  it("handles mixed quoted and unquoted tokens", () => {
    const result = parseFilterTokens('author "Phys. Rev." 2024');
    expect(result).toEqual([
      { text: "author", quoted: false },
      { text: "Phys. Rev.", quoted: true },
      { text: "2024", quoted: false },
    ]);
  });

  it("handles multiple whitespace characters", () => {
    const result = parseFilterTokens("hello    world");
    expect(result).toEqual([
      { text: "hello", quoted: false },
      { text: "world", quoted: false },
    ]);
  });

  it("handles tab and newline as whitespace", () => {
    const result = parseFilterTokens("hello\tworld\ntest");
    expect(result.length).toBe(3);
    expect(result[0].text).toBe("hello");
    expect(result[1].text).toBe("world");
    expect(result[2].text).toBe("test");
  });

  it("handles unclosed quote at end", () => {
    const result = parseFilterTokens('"hello');
    expect(result).toEqual([{ text: "hello", quoted: true }]);
  });

  it("trims whitespace inside tokens", () => {
    const result = parseFilterTokens('"  hello  "');
    expect(result[0].text).toBe("hello");
  });
});

describe("buildFilterTokenVariants", () => {
  it("returns normalized variants", () => {
    const result = buildFilterTokenVariants("Müller");
    expect(result).toContain("muller");
    expect(result).toContain("mueller");
  });

  it("collapses spaces and dots when ignoreSpaceDot is true", () => {
    const result = buildFilterTokenVariants("Phys. Rev. D", {
      ignoreSpaceDot: true,
    });
    expect(result).toContain("phys. rev. d");
    expect(result).toContain("physrevd");
  });

  it("keeps original format when ignoreSpaceDot is false", () => {
    const result = buildFilterTokenVariants("Phys. Rev. D", {
      ignoreSpaceDot: false,
    });
    expect(result).toContain("phys. rev. d");
    expect(result).not.toContain("physrevd");
  });

  it("handles empty input", () => {
    expect(buildFilterTokenVariants("")).toEqual([]);
  });
});
