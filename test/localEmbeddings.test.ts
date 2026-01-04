import { describe, it, expect } from "vitest";
import {
  tokenizeForEmbedding,
  buildHashingEmbedding,
  dotProduct,
} from "../src/modules/inspire/llm/localEmbeddings";

describe("tokenizeForEmbedding", () => {
  it("drops stopwords and short tokens", () => {
    expect(tokenizeForEmbedding("the a an in of")).toEqual([]);
    expect(tokenizeForEmbedding("a b c")).toEqual([]);
  });

  it("keeps unicode letters/numbers and normalizes punctuation", () => {
    expect(tokenizeForEmbedding("Higgs-boson, 125 GeV!")).toEqual([
      "higgs",
      "boson",
      "125",
      "gev",
    ]);
  });

  it("deduplicates consecutive duplicates (PDF cache artifacts)", () => {
    expect(tokenizeForEmbedding("section section section title")).toEqual([
      "section",
      "title",
    ]);
  });

  it("uses overlapping bigrams for CJK text", () => {
    expect(tokenizeForEmbedding("暗物质直接探测")).toEqual([
      "暗物",
      "物质",
      "质直",
      "直接",
      "接探",
      "探测",
    ]);
  });
});

describe("buildHashingEmbedding", () => {
  it("returns a zero vector for empty/stopword-only input", () => {
    const v = buildHashingEmbedding("the and of");
    expect(v.length).toBeGreaterThan(0);
    expect(dotProduct(v, v)).toBe(0);
  });

  it("produces normalized vectors (self-similarity ≈ 1)", () => {
    const v = buildHashingEmbedding("dark matter direct detection constraints");
    expect(dotProduct(v, v)).toBeCloseTo(1, 6);
  });

  it("gives higher similarity for related texts than unrelated", () => {
    const q = buildHashingEmbedding("lattice qcd equation of state");
    const a = buildHashingEmbedding("equation of state from lattice qcd at finite temperature");
    const b = buildHashingEmbedding("neural networks for image segmentation");
    expect(dotProduct(q, a)).toBeGreaterThan(dotProduct(q, b));
  });

  it("has non-zero overlap for related CJK phrases", () => {
    const q = buildHashingEmbedding("暗物质直接探测");
    const a = buildHashingEmbedding("直接探测暗物质实验");
    expect(dotProduct(q, a)).toBeGreaterThan(0);
  });

  it("honors the requested dimension", () => {
    const v = buildHashingEmbedding("hello world", 32);
    expect(v.length).toBe(32);
    expect(dotProduct(v, v)).toBeCloseTo(1, 6);
  });
});
