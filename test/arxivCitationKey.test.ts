import { describe, expect, it } from "vitest";
import { arxivCitationKey } from "../src/modules/arxiv/citationKey";
import { itemCitationKey } from "../src/modules/inspire/library/itemCitationKey";

// The citation key of an arXiv paper in neither the library nor INSPIRE, in
// the owner's Better BibTeX fallback form (auth + ':' + year +
// shorttitle(1).lower). The titles with a library key are from keys Better
// BibTeX made in the owner's library (2026-09-29).

const key = (
  title: string,
  author: string | { display: string },
  id = "2609.28538",
) =>
  arxivCitationKey({
    id,
    title,
    authors: [
      typeof author === "string"
        ? { display: `A. ${author}`, family: author }
        : author,
    ],
  });

describe("arXiv citation key", () => {
  it("is the family name, the identifier's year and the first significant title word", () => {
    expect(
      key("Kostka systems and exotic t-structures", "Finkelberg", "2201.01234"),
    ).toBe("Finkelberg:2022kostka");
  });

  it("passes over Better BibTeX's skip words and one-letter words (library keys)", () => {
    expect(
      key("An upper pressure limit for low-Z benign termination", "Hoppe"),
    ).toBe("Hoppe:2026upper");
    expect(key("The JOREK non-linear extended MHD code", "Hoelzl")).toBe(
      "Hoelzl:2026jorek",
    );
    expect(
      key(
        "On the Effect of Beating during Nonlinear Frequency Chirping",
        "Bierwage",
      ),
    ).toBe("Bierwage:2026effect");
  });

  it("joins a hyphenated word, and separates words at '/', ':' and apostrophes (library keys)", () => {
    expect(key("A quarter-century of H-mode studies", "Wagner")).toBe(
      "Wagner:2026quartercentury",
    );
    expect(key("MCP-Atlas: A Large-Scale Benchmark", "Bandi")).toBe(
      "Bandi:2026mcpatlas",
    );
    expect(
      key("JPAC’s role in Hadron Spectroscopy Analysis", "Szczepaniak"),
    ).toBe("Szczepaniak:2026jpac");
  });

  it("keeps a family name with particles in one word, its letters in plain ASCII", () => {
    expect(key("Global gyrokinetic simulations", "Di Siena")).toBe(
      "DiSiena:2026global",
    );
    expect(key("Heavy quarks", "Müller")).toBe("Muller:2026heavy");
    expect(key("Heavy quarks", "Ørsted")).toBe("Orsted:2026heavy");
    expect(key("Heavy quarks", "Łuczak")).toBe("Luczak:2026heavy");
    expect(key("Équations différentielles", "Kovács")).toBe(
      "Kovacs:2026equations",
    );
  });

  it("uses a collaboration's name as INSPIRE does", () => {
    expect(
      key("Search for new physics", { display: "ATLAS Collaboration" }),
    ).toBe("ATLAS:2026search");
    expect(
      key("Search for new physics", { display: "The CMS Collaboration" }),
    ).toBe("CMS:2026search");
    expect(
      key("GW250114: testing Hawking's area law", {
        display: "LIGO Scientific Collaboration and Virgo Collaboration",
      }),
    ).toBe("LIGOScientific:2026gw250114");
  });

  it("reads a title's TeX as its letters, and an old identifier's year", () => {
    expect(key("$B_s^0$ decays at LHCb", "Smith")).toBe("Smith:2026bs0");
    expect(key("Heavy quarks", "Smith", "hep-ph/0101001")).toBe(
      "Smith:2001heavy",
    );
    expect(key("Heavy quarks", "Smith", "hep-th/9901001")).toBe(
      "Smith:1999heavy",
    );
  });
});

describe("an item's citation key", () => {
  const item = (fields: Record<string, string>) =>
    ({
      getField: (name: string) => fields[name] ?? "",
    }) as unknown as Zotero.Item;

  it("is Zotero's citationKey field, else a Citation Key line of Extra", () => {
    expect(itemCitationKey(item({ citationKey: " Ahn:2025exotic " }))).toBe(
      "Ahn:2025exotic",
    );
    expect(
      itemCitationKey(
        item({ extra: "tex.note: x\nCitation Key: Brambilla:2015rqa" }),
      ),
    ).toBe("Brambilla:2015rqa");
    expect(itemCitationKey(item({}))).toBeNull();
  });
});
