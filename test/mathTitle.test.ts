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
