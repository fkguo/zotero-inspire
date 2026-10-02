import { describe, expect, it } from "vitest";

import { cleanMathTitle } from "../src/utils/mathTitle";

describe("cleanMathTitle particle notation", () => {
  it("preserves neutrino as a natural-language word", () => {
    expect(cleanMathTitle("Are neutrino masses modular forms?")).toBe(
      "Are neutrino masses modular forms?",
    );
    expect(cleanMathTitle("Neutrino oscillations in matter")).toBe(
      "Neutrino oscillations in matter",
    );
  });

  it("preserves neutrino while normalizing all-caps titles", () => {
    expect(cleanMathTitle("NEUTRINO MASSES AND MIXING")).toBe(
      "Neutrino Masses and Mixing",
    );
  });

  it("still converts explicit nu notation to the neutrino symbol", () => {
    expect(cleanMathTitle(String.raw`Masses of \nu_e and nu`)).toBe(
      "Masses of νₑ and ν",
    );
  });
});

describe("cleanMathTitle sub- and superscripts", () => {
  it("writes a superscript \\ast as it writes a superscript *", () => {
    // arXiv:2610.00138's title has $B_c^\ast(1S)$
    expect(
      cleanMathTitle(String.raw`The $B_c$ system after the $B_c^\ast(1S)$`),
    ).toBe("The B<sub>c</sub> system after the B<sub>c</sub><sup>*</sup>(1S)");
    expect(cleanMathTitle(String.raw`$D^\ast\bar{D}^{\ast}$ and $D^*$`)).toBe(
      "D<sup>*</sup>D̄<sup>*</sup> and D<sup>*</sup>",
    );
  });
});
