import { describe, expect, it } from "vitest";
import {
  ARXIV_ARCHIVES,
  ARXIV_CATEGORIES,
  ARXIV_GROUPS,
  arxivCategory,
  subscriptionPageSpecs,
} from "../src/modules/arxiv/arxivCategories";

// The category table generated from arXiv's taxonomy (arxiv-base
// definitions.py at the commit the generator pins).

describe("arxivCategories.json", () => {
  it("has arXiv's 8 groups, 20 archives and 155 categories", () => {
    expect(ARXIV_GROUPS.map((group) => group.id)).toEqual([
      "grp_cs",
      "grp_econ",
      "grp_eess",
      "grp_math",
      "grp_physics",
      "grp_q-bio",
      "grp_q-fin",
      "grp_stat",
    ]);
    expect(ARXIV_ARCHIVES).toHaveLength(20);
    expect(ARXIV_CATEGORIES).toHaveLength(155);
    const archives = new Set(ARXIV_ARCHIVES.map((archive) => archive.id));
    const groups = new Set(ARXIV_GROUPS.map((group) => group.id));
    for (const category of ARXIV_CATEGORIES) {
      expect(archives.has(category.archive)).toBe(true);
      expect(groups.has(category.group)).toBe(true);
    }
  });

  it("pairs the six aliases with their canonical categories both ways", () => {
    const aliases = ARXIV_CATEGORIES.filter(
      (category) => category.canonical !== category.id,
    ).map((category) => [category.id, category.canonical]);
    expect(aliases).toEqual([
      ["cs.NA", "math.NA"],
      ["cs.SY", "eess.SY"],
      ["math.IT", "cs.IT"],
      ["math.MP", "math-ph"],
      ["q-fin.EC", "econ.GN"],
      ["stat.TH", "math.ST"],
    ]);
    for (const [alias, canonical] of aliases) {
      expect(arxivCategory(alias)?.aliases).toEqual([canonical]);
      expect(arxivCategory(canonical)?.aliases).toEqual([alias]);
    }
    expect(arxivCategory("math.MP")).toMatchObject({
      name: "Mathematical Physics",
      archive: "math",
      group: "grp_math",
    });
    expect(arxivCategory("hep-ph")).toMatchObject({
      archive: "hep-ph",
      group: "grp_physics",
      canonical: "hep-ph",
      aliases: [],
    });
  });
});

describe("subscriptionPageSpecs", () => {
  it("fetches an alias as its canonical category, once, in order", () => {
    expect(
      subscriptionPageSpecs([
        "math.MP",
        "hep-ph",
        "math-ph",
        "stat.TH",
        "cs.SY",
        "q-fin.EC",
        "cs.NA",
        "math.IT",
        "hep-ph",
      ]),
    ).toEqual([
      "math-ph",
      "hep-ph",
      "math.ST",
      "eess.SY",
      "econ.GN",
      "math.NA",
      "cs.IT",
    ]);
  });

  it("keeps whole archives and their categories as separate pages", () => {
    expect(subscriptionPageSpecs(["math", "math.AG", "cs.LG"])).toEqual([
      "math",
      "math.AG",
      "cs.LG",
    ]);
  });
});
