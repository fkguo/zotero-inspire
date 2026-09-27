// ─────────────────────────────────────────────────────────────────────────────
// arxivId.test.ts - strict arXiv identifier parsing and the per-field
// candidates of a Zotero item
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  arxivCandidateFromArchiveID,
  arxivCandidateFromArchiveLocation,
  arxivCandidateFromDOI,
  arxivCandidateFromJournalAbbreviation,
  arxivCandidateFromUrl,
  arxivCandidatesFromExtra,
  arxivIdFromItem,
  arxivIdsFromFields,
  parseArxivId,
} from "../src/modules/arxiv/arxivId";
import { archives } from "../src/modules/arxiv/arxivArchives.json";

describe("parseArxivId: accepted forms", () => {
  it.each([
    // New style: four digits 2007-04 to 2014-12, five digits from 2015
    ["0704.0001", "0704.0001", undefined],
    ["1412.9999", "1412.9999", undefined],
    ["1501.00001", "1501.00001", undefined],
    ["2609.28544", "2609.28544", undefined],
    // Old style 1991-07 to 2007-03, discontinued archives included
    ["hep-th/9108001", "hep-th/9108001", undefined],
    ["hep-ph/0703001", "hep-ph/0703001", undefined],
    ["alg-geom/9503001", "alg-geom/9503001", undefined],
    ["chao-dyn/9301001", "chao-dyn/9301001", undefined],
    ["q-alg/9412001", "q-alg/9412001", undefined],
    ["physics/0101001", "physics/0101001", undefined],
    // Subject classes are dropped: arxiv.org/abs/math.GT/0309136 is math/0309136
    ["math.GT/0309136", "math/0309136", undefined],
    ["math.gt/0309136", "math/0309136", undefined],
    ["q-bio.BM/0401004", "q-bio/0401004", undefined],
    ["cs.AI/0101001", "cs/0101001", undefined],
    ["nlin.CD/0101001", "nlin/0101001", undefined],
    ["HEP-PH/0101001", "hep-ph/0101001", undefined],
    // Versions of any length
    ["2301.12345v1", "2301.12345", 1],
    ["2301.12345v10", "2301.12345", 10],
    ["2301.12345v123", "2301.12345", 123],
    ["2301.12345V2", "2301.12345", 2],
    ["hep-ph/0101001v3", "hep-ph/0101001", 3],
    ["math.GT/0309136v2", "math/0309136", 2],
    ["solv-int/9901001v2", "solv-int/9901001", 2],
    // Prefix
    ["arXiv:2301.12345", "2301.12345", undefined],
    ["arXiv: 2301.12345v2", "2301.12345", 2],
    ["ARXIV:hep-ph/0101001", "hep-ph/0101001", undefined],
    // URLs: abs and pdf pages, www. and export., query string and .pdf dropped
    ["https://arxiv.org/abs/2301.12345", "2301.12345", undefined],
    ["http://arxiv.org/abs/2301.12345v2", "2301.12345", 2],
    ["https://www.arxiv.org/pdf/2301.12345", "2301.12345", undefined],
    ["https://export.arxiv.org/abs/2301.12345", "2301.12345", undefined],
    ["https://arxiv.org/pdf/2301.12345v2.pdf", "2301.12345", 2],
    ["https://arxiv.org/abs/2301.12345v2?context=hep-ph", "2301.12345", 2],
    ["https://arxiv.org/abs/2301.12345#references", "2301.12345", undefined],
    ["https://arxiv.org/abs/hep-ph/0101001v1", "hep-ph/0101001", 1],
    ["https://arxiv.org/abs/math.GT/0309136", "math/0309136", undefined],
    ["HTTPS://ARXIV.ORG/ABS/2301.12345", "2301.12345", undefined],
    // arXiv DOI
    ["10.48550/arXiv.2301.12345", "2301.12345", undefined],
    ["10.48550/ARXIV.hep-ph/0101001", "hep-ph/0101001", undefined],
    // Surrounding white space
    ["  2301.12345\n", "2301.12345", undefined],
  ])("%j -> %j (version %j)", (input, id, version) => {
    const parsed = parseArxivId(input);
    expect(parsed).toEqual(version === undefined ? { id } : { id, version });
  });
});

describe("parseArxivId: rejected forms", () => {
  it.each([
    // Incomplete or overlong numbers
    "2609.1",
    "2301.123",
    "2301.123456",
    "hep-ph/01",
    "hep-ph/010100",
    "hep-ph/01010011",
    // Four digits from 2015 on and five digits before: 1501.0123 is not a
    // prefix of 1501.01234, it is no identifier at all
    "1501.0123",
    "1412.00001",
    // Impossible months and dates outside each scheme
    "2313.12345",
    "2300.12345",
    "0703.1234",
    "hep-ph/0113001",
    "hep-ph/0100001",
    "hep-th/9106001",
    "hep-ph/0704001",
    // Sequence number zero, version zero
    "2301.00000",
    "0704.0000",
    "hep-ph/0101000",
    "2301.12345v0",
    "2301.12345v01",
    "2301.12345v",
    // Archive names arXiv never had in old-style identifiers, subject classes
    // of the wrong archive
    "foo/9901001",
    "gt/0309136",
    "stat/0101001",
    "test/9901001",
    "hep-ph.GT/9901001",
    "math.GTX/0309136",
    "math.XX/0309136",
    // Other hosts, other paths, other prefixes, trailing text
    "https://arxiv.org/list/hep-ph/new",
    "https://example.org/abs/2301.12345",
    "ftp://arxiv.org/abs/2301.12345",
    "arxiv.org/abs/2301.12345",
    "10.1103/PhysRevD.100.012345",
    "2301.12345.",
    "2301.12345 [hep-ph]",
    "2301.12345.pdf",
    "eprint:2301.12345",
    "",
    "   ",
  ])("%j -> null", (input) => {
    expect(parseArxivId(input)).toBeNull();
  });

  it("returns null for a missing value", () => {
    expect(parseArxivId(null)).toBeNull();
    expect(parseArxivId(undefined)).toBeNull();
  });
});

describe("parseArxivId: formats found by Zotero.Utilities.extractIdentifiers", () => {
  // Zotero 10.0.3 chrome/content/zotero/xpcom/utilities/utilities.js
  // extractIdentifiers(): the identifiers it takes from text, version dropped
  const ZOTERO_ARXIV_RE =
    /((?:[^A-Za-z]|^)([\-A-Za-z\.]+\/\d{7})(?:(v[0-9]+)|)(?!\d))|((?:\D|^)(\d{4}\.\d{4,5})(?:(v[0-9]+)|)(?!\d))/g;
  const zoteroArxivIds = (text: string) =>
    [...text.matchAll(ZOTERO_ARXIV_RE)].map((m) => m[2] || m[5]);
  const COPIED_FROM =
    "regex copied from Zotero 10.0.3 utilities.js extractIdentifiers()";

  it.each([
    ["0706.0044", "0706.0044"],
    ["arXiv:0706.0044v1", "0706.0044"],
    ["see arXiv:1501.00001v3 for details", "1501.00001"],
    ["https://arxiv.org/abs/2301.12345", "2301.12345"],
    ["hep-th/9802109", "hep-th/9802109"],
    ["arXiv:hep-ph/0101001v2", "hep-ph/0101001"],
    ["math.GT/0309136", "math/0309136"],
    ["https://arxiv.org/abs/math.GT/0309136v1", "math/0309136"],
  ])("text %j: Zotero finds one ID, parsed as %j", (text, canonical) => {
    const found = zoteroArxivIds(text);
    expect(found, COPIED_FROM).toHaveLength(1);
    expect(parseArxivId(found[0])?.id).toBe(canonical);
  });

  it.each([
    ["2313.12345", "2313.12345"],
    ["1501.0123", "1501.0123"],
    ["foo.XX/0101001", "foo.XX/0101001"],
  ])("text %j: Zotero finds %j, which is no arXiv identifier", (text, id) => {
    expect(zoteroArxivIds(text), COPIED_FROM).toEqual([id]);
    expect(parseArxivId(id)).toBeNull();
  });
});

describe("historical archive table", () => {
  const ids = archives.map((archive) => archive.id);

  it("holds the discontinued archives and no archive started after 2007-03", () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        "alg-geom",
        "chao-dyn",
        "q-alg",
        "solv-int",
        "hep-ph",
        "math",
      ]),
    );
    expect(ids).not.toContain("stat");
    expect(ids).not.toContain("q-fin");
    expect(ids).not.toContain("econ");
    expect(ids).not.toContain("test");
    expect(archives.every((archive) => archive.start < "2007-04")).toBe(true);
  });

  it("gives the subject classes of math", () => {
    const math = archives.find((archive) => archive.id === "math");
    expect(math?.subjectClasses).toEqual(expect.arrayContaining(["GT", "AG"]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Candidates per field
// ─────────────────────────────────────────────────────────────────────────────

describe("arxivCandidatesFromExtra", () => {
  it.each([
    ["arXiv:2301.12345 [hep-ph]", ["2301.12345"]],
    ["arXiv:2301.12345[hep-ph]", ["2301.12345"]],
    ["arXiv: 2301.12345", ["2301.12345"]],
    ["ARXIV:hep-ph/0101001", ["hep-ph/0101001"]],
    ["_eprint: 2301.12345", ["2301.12345"]],
    ["DOI: 10.48550/arXiv.2301.12345", ["2301.12345"]],
    ["  arXiv:2301.12345", ["2301.12345"]],
    [
      "Citation Key: Doe:2023\narXiv:2301.12345 [hep-ph]\r\n_eprint: 2302.00001\n3 citations (INSPIRE 2026/9/1)",
      ["2301.12345", "2302.00001"],
    ],
    ["Report number: arXiv:2301.12345", []],
    ["Original arXiv DOI: 10.48550/arXiv.2301.12345", []],
    ["DOI: 10.1103/PhysRevD.100.012345", []],
    ["", []],
  ])("%j -> %j", (extra, expected) => {
    expect(arxivCandidatesFromExtra(extra)).toEqual(expected);
  });
});

describe("arxivCandidateFromJournalAbbreviation", () => {
  it.each([
    ["arXiv:2301.12345 [hep-ph]", "2301.12345"],
    ["arXiv:2301.12345", "2301.12345"],
    ["arXiv:hep-ph/0101001", "hep-ph/0101001"],
    ["arXiv:2301.12345 and more", null],
    ["Phys. Rev. D", null],
    ["", null],
  ])("%j -> %j", (value, expected) => {
    expect(arxivCandidateFromJournalAbbreviation(value)).toBe(expected);
  });
});

describe("arxivCandidateFromArchiveID", () => {
  it.each([
    ["arXiv:2301.12345", "2301.12345"],
    ["arXiv:hep-ph/0101001", "hep-ph/0101001"],
    ["2301.12345", null],
    ["", null],
  ])("%j -> %j", (value, expected) => {
    expect(arxivCandidateFromArchiveID(value)).toBe(expected);
  });
});

describe("arxivCandidateFromUrl", () => {
  it.each([
    ["https://arxiv.org/abs/2301.12345v2", "2301.12345v2"],
    ["http://www.arxiv.org/pdf/2301.12345", "2301.12345"],
    ["https://export.arxiv.org/abs/2301.12345", "2301.12345"],
    ["https://arxiv.org/pdf/2301.12345v2.pdf", "2301.12345v2"],
    ["https://arxiv.org/abs/2301.12345?context=hep-ph", "2301.12345"],
    ["https://arxiv.org/abs/hep-ph/0101001", "hep-ph/0101001"],
    ["https://ArXiv.org/abs/2301.12345", "2301.12345"],
    ["https://arxiv.org/list/hep-ph/new", null],
    ["https://arxiv.org/abs/a/b/c", null],
    ["https://inspirehep.net/literature/123", null],
    ["arxiv.org/abs/2301.12345", null],
    ["", null],
  ])("%j -> %j", (url, expected) => {
    expect(arxivCandidateFromUrl(url)).toBe(expected);
  });
});

describe("arxivCandidateFromDOI", () => {
  it.each([
    ["10.48550/arXiv.2301.12345", "2301.12345"],
    ["10.48550/ARXIV.hep-ph/0101001", "hep-ph/0101001"],
    ["10.1103/PhysRevD.100.012345", null],
    ["", null],
  ])("%j -> %j", (doi, expected) => {
    expect(arxivCandidateFromDOI(doi)).toBe(expected);
  });
});

describe("arxivCandidateFromArchiveLocation", () => {
  it.each([
    ["arXiv:2301.12345", "", "2301.12345"],
    ["arXiv: 2301.12345", "INSPIRE", "2301.12345"],
    ["2301.12345", "arXiv", "2301.12345"],
    ["2301.12345", " ARXIV ", "2301.12345"],
    ["1234567", "INSPIRE", null],
    ["1234567", "", null],
    ["2301.12345", "", null],
    ["", "arXiv", null],
  ])("%j with Archive %j -> %j", (value, archive, expected) => {
    expect(arxivCandidateFromArchiveLocation(value, archive)).toBe(expected);
  });
});

describe("arxivIdsFromFields", () => {
  it("gives each canonical ID once, Extra first", () => {
    expect(
      arxivIdsFromFields({
        extra: "arXiv:2301.12345v2 [hep-ph]",
        journalAbbreviation: "arXiv:2301.12345 [hep-ph]",
        archiveID: "arXiv:2301.12345",
        url: "https://arxiv.org/abs/2301.12345",
        DOI: "10.48550/arXiv.2301.12345",
      }),
    ).toEqual(["2301.12345"]);
  });

  it("keeps every ID of an item that names two papers", () => {
    expect(
      arxivIdsFromFields({
        extra: "arXiv:2302.00001 [hep-th]",
        url: "https://arxiv.org/abs/math.GT/0309136",
        archiveLocation: "1234567",
        archive: "INSPIRE",
      }),
    ).toEqual(["2302.00001", "math/0309136"]);
  });

  it("skips candidates that are no identifiers", () => {
    expect(
      arxivIdsFromFields({
        extra: "arXiv:2301.1",
        journalAbbreviation: "arXiv:1501.0123",
        DOI: "10.48550/arXiv.hep-ph/0101001",
      }),
    ).toEqual(["hep-ph/0101001"]);
    expect(arxivIdsFromFields({})).toEqual([]);
  });
});

describe("arxivIdFromItem", () => {
  const item = (fields: Record<string, string>) =>
    ({ getField: (name: string) => fields[name] ?? "" }) as any;

  it("reads the first identifier of the item's fields", () => {
    expect(
      arxivIdFromItem(
        item({
          journalAbbreviation: "arXiv:2301.12345 [hep-ph]",
          extra: "arXiv:2302.00001 [hep-th]",
        }),
      ),
    ).toBe("2302.00001");
    expect(
      arxivIdFromItem(
        item({ archive: "arXiv", archiveLocation: "2301.12345" }),
      ),
    ).toBe("2301.12345");
    expect(arxivIdFromItem(item({ title: "No identifier" }))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Archive Location. Regression: an INSPIRE recid there was returned as an
// arXiv ID. Fields that do not exist for a type read back as "" (getField).
// ─────────────────────────────────────────────────────────────────────────────

function fakeItem(fields: Record<string, string> = {}): any {
  return {
    id: 1,
    itemType: "journalArticle",
    getField: (field: string) => fields[field] ?? "",
  };
}

describe("arxivIdFromItem: Archive Location (from apiUtils.extractArxivIdFromItem)", () => {
  it("does not read an INSPIRE recid in Archive Location as an arXiv ID", () => {
    expect(
      arxivIdFromItem(
        fakeItem({ archive: "INSPIRE", archiveLocation: "1234567" }),
      ),
    ).toBeNull();
    expect(
      arxivIdFromItem(fakeItem({ archiveLocation: "1234567" })),
    ).toBeNull();
  });

  it("requires an arXiv marker even when Archive Location looks like an arXiv ID", () => {
    expect(
      arxivIdFromItem(
        fakeItem({ archive: "INSPIRE", archiveLocation: "2101.01234" }),
      ),
    ).toBeNull();
  });

  it.each([
    ["arXiv:2101.01234", "2101.01234"],
    ["arXiv: 2101.01234", "2101.01234"],
    ["arXiv:2101.01234v2", "2101.01234"],
    ["ARXIV:0704.0001", "0704.0001"],
    ["arXiv:1412.9999", "1412.9999"],
    ["arXiv:1501.00001", "1501.00001"],
    ["arXiv:hep-ph/0001234", "hep-ph/0001234"],
    ["arXiv:hep-th/9108001", "hep-th/9108001"],
    // the old scheme's documented range is 9107-0703
    ["arXiv:hep-th/9107001", "hep-th/9107001"],
    ["arXiv:math/0703001", "math/0703001"],
  ])("reads the ID from Archive Location %s", (archiveLocation, id) => {
    expect(arxivIdFromItem(fakeItem({ archiveLocation }))).toBe(id);
  });

  it("reads Archive Location when Archive is arXiv", () => {
    expect(
      arxivIdFromItem(
        fakeItem({ archive: "arXiv", archiveLocation: "2101.01234" }),
      ),
    ).toBe("2101.01234");
    expect(
      arxivIdFromItem(
        fakeItem({ archive: "ARXIV", archiveLocation: "hep-th/9901001v1" }),
      ),
    ).toBe("hep-th/9901001");
  });

  // Intentional change: the subject class is dropped from the ID (before, the
  // funding export kept it: math.GT/0309136 is an alias of math/0309136)
  it.each([
    [
      { archiveLocation: "arXiv:math.GT/0309136" },
      "math.GT/0309136",
      "math/0309136",
    ],
    [
      { archiveLocation: "arXiv:q-bio.BM/0401004" },
      "q-bio.BM/0401004",
      "q-bio/0401004",
    ],
    [
      { archive: "arXiv", archiveLocation: "math.DG/0211159" },
      "math.DG/0211159",
      "math/0211159",
    ],
  ])(
    "reads Archive Location %j: %j before -> %j after",
    (fields, _before, after) => {
      expect(arxivIdFromItem(fakeItem(fields))).toBe(after);
    },
  );

  it("rejects values that are not arXiv IDs even when marked as arXiv", () => {
    expect(
      arxivIdFromItem(fakeItem({ archiveLocation: "arXiv:1234567" })),
    ).toBeNull();
    expect(
      arxivIdFromItem(
        fakeItem({ archive: "arXiv", archiveLocation: "1234567" }),
      ),
    ).toBeNull();
    expect(
      arxivIdFromItem(
        fakeItem({ archive: "arXiv", archiveLocation: "hep-ph/000123" }),
      ),
    ).toBeNull();
    // a subject class must be one of its archive's classes (hep-ph has none)
    expect(
      arxivIdFromItem(fakeItem({ archiveLocation: "arXiv:math.GTX/0309136" })),
    ).toBeNull();
    expect(
      arxivIdFromItem(fakeItem({ archiveLocation: "arXiv:hep-ph.GT/9901001" })),
    ).toBeNull();
    // an archive name is letters, joined by single hyphens
    expect(
      arxivIdFromItem(fakeItem({ archiveLocation: "arXiv:---/9901001" })),
    ).toBeNull();
  });

  it.each([
    // impossible month or version, or a zero sequence number
    "arXiv:9913.12345",
    "arXiv:hep-ph/0013123",
    "arXiv:2301.12345v0",
    "arXiv:2101.00000",
    "arXiv:hep-ph/0001000",
    // four-digit sequence numbers ran 0704-1412, five-digit ones from 1501
    "arXiv:2301.1234",
    "arXiv:1412.00001",
    "arXiv:0703.0001",
    // old-style identifiers ran 9107-0703
    "arXiv:hep-th/9106001",
    "arXiv:hep-ph/0704001",
  ])(
    "rejects a value outside arXiv's identifier scheme: %s",
    (archiveLocation) => {
      expect(arxivIdFromItem(fakeItem({ archiveLocation }))).toBeNull();
    },
  );

  it("still prefers Extra and URL over Archive Location", () => {
    expect(
      arxivIdFromItem(
        fakeItem({
          extra: "arXiv:2301.12345 [hep-ph]",
          archive: "INSPIRE",
          archiveLocation: "1234567",
        }),
      ),
    ).toBe("2301.12345");
    expect(
      arxivIdFromItem(
        fakeItem({
          url: "https://arxiv.org/abs/hep-ph/0001234",
          archive: "INSPIRE",
          archiveLocation: "1234567",
        }),
      ),
    ).toBe("hep-ph/0001234");
  });
});
