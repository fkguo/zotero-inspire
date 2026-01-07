import { describe, expect, it } from "vitest";
import { normalizeHtmlSupSubToLatex } from "../src/modules/inspire/llm/textSanitizers";

describe("normalizeHtmlSupSubToLatex", () => {
  it("converts <sup> to inline LaTeX", () => {
    expect(normalizeHtmlSupSubToLatex("p-<sup>11</sup>B")).toBe("p-$^{11}$B");
    expect(normalizeHtmlSupSubToLatex("D<sup>*</sup>")).toBe("D$^{*}$");
  });

  it("converts <sub> to inline LaTeX", () => {
    expect(normalizeHtmlSupSubToLatex("H<sub>2</sub>O")).toBe("H$_{2}$O");
  });

  it("handles multiple tags and mixed case", () => {
    expect(
      normalizeHtmlSupSubToLatex("10<SUP>16</SUP> s·m<sup>-3</sup>"),
    ).toBe("10$^{16}$ s·m$^{-3}$");
  });

  it("returns input unchanged when no tags are present", () => {
    const input = "plain text";
    expect(normalizeHtmlSupSubToLatex(input)).toBe(input);
  });
});

