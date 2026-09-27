// ─────────────────────────────────────────────────────────────────────────────
// arXiv identifiers in PDF citation matching
//
// Fixes the results of every place where PDF citation matching compares arXiv
// identifiers (all through matchScoring.normalizeArxivId): the normalizer
// itself, the identifier index and its lookup, the composite score and the
// strong-match test, linked-reference matching, author-year matching with PDF
// reference data, numeric labels resolved from the PDF reference list, and the
// arXiv tokens of the Zotero-native citation overlay.
//
// Cases written "before -> after" are the intentional behaviour changes of the
// strict parser (parseArxivId): "before" is what normalizeArxivId gave until it
// switched to the parser (the previous commit fixed those values), "after" is
// what it gives now.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LabelMatcher } from "../src/modules/inspire/pdfAnnotate/labelMatcher";
import {
  buildIdentifierIndexes,
  findByArxiv,
} from "../src/modules/inspire/pdfAnnotate/labelMatcher/identifierIndex";
import { findPreciseMatch } from "../src/modules/inspire/pdfAnnotate/labelMatcher/authorYearMatcher";
import {
  calculateCompositeScore,
  getStrongMatchKind,
  normalizeArxivId,
} from "../src/modules/inspire/pdfAnnotate/matchScoring";
import { SCORE } from "../src/modules/inspire/pdfAnnotate/constants";
import {
  createNativeOverlayBuildState,
  runNativeOverlayBuildSlice,
} from "../src/modules/inspire/pdfAnnotate/nativeOverlayBuilder";
import {
  AUDITED_ZOTERO_10_BUILD_IDS,
  NativeOverlayAdapter,
  selectNativeOverlayProfile,
} from "../src/modules/inspire/pdfAnnotate/nativeOverlayProfile";
import type { NativeOverlayMatchPackage } from "../src/modules/inspire/pdfAnnotate/nativeOverlayTypes";
import type { PDFPaperInfo } from "../src/modules/inspire/pdfAnnotate/pdfReferencesParser";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

beforeEach(() => {
  (globalThis as any).Zotero = {
    debug: vi.fn(),
    Prefs: { get: vi.fn(() => undefined) },
  };
});

function entry(
  id: string,
  arxivDetails: InspireReferenceEntry["arxivDetails"],
  extra: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    authorText: "",
    arxivDetails,
    ...extra,
  } as InspireReferenceEntry;
}

function paper(
  arxivId: string,
  extra: Partial<PDFPaperInfo> = {},
): PDFPaperInfo {
  return { rawText: `reference ${arxivId}`, arxivId, ...extra };
}

// ─────────────────────────────────────────────────────────────────────────────
// The normalizer
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeArxivId", () => {
  it.each([
    // New-style identifiers, with and without version
    ["2301.12345", "2301.12345"],
    ["2301.12345v2", "2301.12345"],
    ["2301.12345v10", "2301.12345"],
    ["2301.12345v99", "2301.12345"],
    ["0704.0001", "0704.0001"],
    ["1412.9999", "1412.9999"],
    ["1501.00001", "1501.00001"],
    [" 2301.12345 ", "2301.12345"],
    // Old-style identifiers, with and without version
    ["hep-ph/0101001", "hep-ph/0101001"],
    ["hep-ph/0101001v1", "hep-ph/0101001"],
    ["HEP-PH/0101001", "hep-ph/0101001"],
    ["hep-th/9108001", "hep-th/9108001"],
    ["alg-geom/9503001", "alg-geom/9503001"],
    ["math/0309136", "math/0309136"],
    // Prefix and URL forms
    ["arXiv:2301.12345", "2301.12345"],
    ["arXiv: 2301.12345", "2301.12345"],
    ["ARXIV:2301.12345", "2301.12345"],
    ["arXiv:hep-ph/0101001v2", "hep-ph/0101001"],
    ["https://arxiv.org/abs/2301.12345", "2301.12345"],
    ["https://arxiv.org/abs/2301.12345v3", "2301.12345"],
    ["http://www.arxiv.org/pdf/2301.12345", "2301.12345"],
    ["https://arxiv.org/pdf/2301.12345.pdf", "2301.12345"],
    ["https://arxiv.org/abs/hep-ph/0101001", "hep-ph/0101001"],
    // Not identifiers
    ["", null],
    ["not an id", null],
    ["1234", null],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeArxivId(input)).toBe(expected);
  });

  it.each([
    // The subclass form of an old-style identifier is an alias of the
    // identifier without it (arxiv.org/abs/math.GT/0309136 is math/0309136)
    ["math.GT/0309136", null, "math/0309136"],
    ["math.GT/0309136v2", null, "math/0309136"],
    ["https://arxiv.org/abs/math.GT/0309136", null, "math/0309136"],
    // Versions of any length are dropped
    ["2301.12345v100", "2301.12345v100", "2301.12345"],
    ["https://arxiv.org/pdf/2301.12345v2.pdf", "2301.12345v2", "2301.12345"],
    // export.arxiv.org, query strings and the arXiv DOI are recognised
    ["https://export.arxiv.org/abs/2301.12345", null, "2301.12345"],
    [
      "https://arxiv.org/abs/2301.12345?context=hep-ph",
      "2301.12345?context=hep-ph",
      "2301.12345",
    ],
    ["10.48550/arXiv.2301.12345", null, "2301.12345"],
    // Incomplete or impossible numbers are no longer passed through
    ["2301.1", "2301.1", null],
    ["2301.123456", "2301.123456", null],
    ["1501.0123", "1501.0123", null],
    ["1412.00001", "1412.00001", null],
    ["2313.12345", "2313.12345", null],
    ["0612.1234", "0612.1234", null],
    ["2301.00000", "2301.00000", null],
    ["2301.12345.", "2301.12345.", null],
    ["hep-ph/010100", "hep-ph/010100", null],
    ["hep-ph/01010011", "hep-ph/01010011", null],
    ["hep-ph/0113001", "hep-ph/0113001", null],
    ["hep-ph/0704001", "hep-ph/0704001", null],
    // Nor are archive names arXiv never had
    ["gt/0309136", "gt/0309136", null],
    ["foo-bar/0101001", "foo-bar/0101001", null],
  ])("%j: %j before -> %j after", (input, _before, after) => {
    expect(normalizeArxivId(input)).toBe(after);
  });

  it("reads the id of an arXiv details object", () => {
    expect(normalizeArxivId({ id: "2301.12345", categories: [] })).toBe(
      "2301.12345",
    );
    expect(normalizeArxivId({ id: "arXiv:hep-ph/0101001" })).toBe(
      "hep-ph/0101001",
    );
    expect(normalizeArxivId({ categories: ["hep-ph"] })).toBe(null);
    expect(normalizeArxivId(null)).toBe(null);
    expect(normalizeArxivId(undefined)).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identifier index and lookup
// ─────────────────────────────────────────────────────────────────────────────

describe("identifier index by arXiv ID", () => {
  const entries = [
    entry("new", "2301.12345"),
    entry("five-digit", { id: "1501.01234", categories: ["hep-ph"] }),
    entry("old", { id: "hep-ph/0101001" }),
    entry("math", { id: "math/0309136" }),
    entry("duplicate", "2301.12345"),
    entry("truncated", "2301.1"),
    entry("none", null),
  ];

  it("indexes each normalized ID once, first entry first", () => {
    const indexes = buildIdentifierIndexes(entries);
    // Before: the truncated ID was indexed too, as ["2301.1", 5]
    expect([...indexes.arxivIndex.entries()]).toEqual([
      ["2301.12345", 0],
      ["1501.01234", 1],
      ["hep-ph/0101001", 2],
      ["math/0309136", 3],
    ]);
  });

  it.each([
    ["arXiv:2301.12345v2", 0],
    ["https://arxiv.org/abs/2301.12345", 0],
    ["1501.01234v1", 1],
    ["1501.0123", -1],
    ["1501.012345", -1],
    ["HEP-PH/0101001", 2],
    ["hep-ph/0101001v1", 2],
    ["math/0309136", 3],
    ["", -1],
    [null, -1],
  ])("finds %j at %i", (query, expected) => {
    const indexes = buildIdentifierIndexes(entries);
    expect(findByArxiv(indexes, query)).toBe(expected);
  });

  it.each([
    // The subclass form finds the entry of its canonical form
    ["math.GT/0309136", -1, 3],
    // A truncated ID no longer finds an entry with the same truncated ID
    ["2301.1", 5, -1],
  ])("finds %j at %i before -> %i after", (query, _before, after) => {
    const indexes = buildIdentifierIndexes(entries);
    expect(findByArxiv(indexes, query)).toBe(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composite score and strong-match test
// ─────────────────────────────────────────────────────────────────────────────

describe("scoring by arXiv ID", () => {
  it.each([
    ["2301.12345", { id: "2301.12345" }, true],
    ["2301.12345v3", "2301.12345", true],
    ["hep-ph/0101001", { id: "hep-ph/0101001" }, true],
    ["1501.0123", { id: "1501.01234" }, false],
    ["2301.12345", { id: "2301.12346" }, false],
    ["2301.12345", null, false],
  ])("PDF %j vs INSPIRE %j -> arXiv match %s", (pdfId, details, matched) => {
    const score = calculateCompositeScore(paper(pdfId), entry("e", details));
    expect(score.arxivMatch).toBe(matched);
    expect(score.breakdown.arxiv).toBe(matched ? SCORE.ARXIV_EXACT : 0);
    expect(getStrongMatchKind(paper(pdfId), entry("e", details))).toEqual(
      matched ? { kind: "arxiv", score: SCORE.ARXIV_EXACT } : null,
    );
  });

  it.each([
    // The subclass form matches its canonical form
    ["math.GT/0309136", "math/0309136", false, true],
    // Identical malformed IDs no longer match each other
    ["2301.1", "2301.1", true, false],
    ["2313.12345", "2313.12345", true, false],
    ["gt/0309136", "gt/0309136", true, false],
  ])(
    "PDF %j vs INSPIRE %j -> arXiv match %s before -> %s after",
    (pdfId, details, _before, matched) => {
      const score = calculateCompositeScore(paper(pdfId), entry("e", details));
      expect(score.arxivMatch).toBe(matched);
      expect(getStrongMatchKind(paper(pdfId), entry("e", details))).toEqual(
        matched ? { kind: "arxiv", score: SCORE.ARXIV_EXACT } : null,
      );
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Linked references (Zotero-native reference records)
// ─────────────────────────────────────────────────────────────────────────────

describe("linked-reference matching by arXiv ID", () => {
  const entries = [
    entry("first", { id: "2301.12345" }, { label: "1" }),
    entry("second", { id: "hep-ph/0101001" }, { label: "2" }),
    entry("third", { id: "math/0309136" }, { label: "3" }),
    entry("fourth", "2301.1", { label: "4" }),
  ];

  it.each([
    ["1", "2301.12345v2", "first", "2301.12345"],
    ["2", "hep-ph/0101001", "second", "hep-ph/0101001"],
    ["3", "math/0309136", "third", "math/0309136"],
  ])("label %s with %j -> %s", (label, pdfId, entryId, value) => {
    const matcher = new LabelMatcher(entries, 7001);
    expect(matcher.matchLinkedReference(label, [paper(pdfId)])).toMatchObject([
      {
        entryId,
        matchMethod: "overlay",
        matchedIdentifier: { type: "arxiv", value },
      },
    ]);
  });

  it("does not match a four-digit prefix of a five-digit ID", () => {
    const matcher = new LabelMatcher(
      [entry("five", { id: "1501.01234" }, { label: "1" })],
      7002,
    );
    expect(matcher.matchLinkedReference("1", [paper("1501.0123")])).toEqual([]);
  });

  it("matches the subclass form to its canonical form (before: no match)", () => {
    const matcher = new LabelMatcher(entries, 7003);
    expect(
      matcher.matchLinkedReference("3", [paper("math.GT/0309136")]),
    ).toMatchObject([
      {
        entryId: "third",
        matchedIdentifier: { type: "arxiv", value: "math/0309136" },
      },
    ]);
  });

  it("does not match identical truncated IDs (before: matched fourth)", () => {
    const matcher = new LabelMatcher(entries, 7004);
    expect(matcher.matchLinkedReference("4", [paper("2301.1")])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Author-year matching with PDF reference data
// ─────────────────────────────────────────────────────────────────────────────

describe("author-year precise matching by arXiv ID", () => {
  const entries = [
    entry(
      "smith-a",
      { id: "1501.01234" },
      { authors: ["Smith, J."], year: "2015" },
    ),
    entry(
      "smith-b",
      { id: "hep-ph/0101001" },
      { authors: ["Smith, J."], year: "2001" },
    ),
    entry(
      "smith-c",
      { id: "math/0309136" },
      { authors: ["Smith, J."], year: "2003" },
    ),
    entry("smith-d", "2301.1", { authors: ["Smith, J."], year: "2023" }),
  ];

  it.each([
    ["arXiv:1501.01234v2", "smith-a"],
    ["HEP-PH/0101001", "smith-b"],
    ["math/0309136", "smith-c"],
  ])("PDF %j -> %s by arXiv", (pdfId, entryId) => {
    const result = findPreciseMatch(
      entries,
      paper(pdfId, { firstAuthorLastName: "Smith" }),
      ["Smith"],
      null,
    );
    expect(result).toMatchObject({
      entryId,
      matchMethod: "exact",
      score: SCORE.ARXIV_EXACT,
    });
  });

  it("does not match a four-digit prefix of a five-digit ID", () => {
    expect(
      findPreciseMatch(
        entries,
        paper("1501.0123", { firstAuthorLastName: "Smith" }),
        ["Smith"],
        null,
      ),
    ).toBeNull();
  });

  it("matches the subclass form to its canonical form (before: no match)", () => {
    expect(
      findPreciseMatch(
        entries,
        paper("math.GT/0309136", { firstAuthorLastName: "Smith" }),
        ["Smith"],
        null,
      ),
    ).toMatchObject({ entryId: "smith-c", score: SCORE.ARXIV_EXACT });
  });

  it("does not match identical truncated IDs (before: matched smith-d)", () => {
    expect(
      findPreciseMatch(
        entries,
        paper("2301.1", { firstAuthorLastName: "Smith" }),
        ["Smith"],
        null,
      ),
    ).toBeNull();
  });

  it("resolves an author-year citation through the PDF reference list", () => {
    const matcher = new LabelMatcher(entries, 7101);
    matcher.setAuthorYearMapping({
      parsedAt: 1,
      authorYearMap: new Map([
        [
          "smith 2015",
          [
            paper("arXiv:1501.01234", {
              firstAuthorLastName: "Smith",
              year: "2015",
            }),
          ],
        ],
      ]),
      totalReferences: 1,
      confidence: "high",
    });
    const results = matcher.matchAuthorYear(["Smith 2015", "Smith", "2015"]);
    expect(results[0]).toMatchObject({
      entryId: "smith-a",
      matchMethod: "exact",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Numeric labels resolved through the PDF reference list (no INSPIRE labels)
// ─────────────────────────────────────────────────────────────────────────────

describe("numeric label resolved by the arXiv ID of the PDF reference", () => {
  function matcherFor(pdfId: string) {
    const matcher = new LabelMatcher(
      [
        entry("other", { id: "2201.00001" }, { year: "2022" }),
        entry("target", { id: "hep-ph/0101001" }, { year: "2001" }),
        entry("third", { id: "math/0309136" }, { year: "2003" }),
      ],
      7201,
    );
    matcher.setPDFMapping({
      parsedAt: 1,
      labelCounts: new Map([["1", 1]]),
      labelPaperInfos: new Map([["1", [paper(pdfId, { year: "2001" })]]]),
      totalLabels: 1,
      confidence: "high",
    });
    return matcher;
  }

  it("finds the entry for an old-style ID with a version", () => {
    expect(matcherFor("hep-ph/0101001v2").match("1")[0]).toMatchObject({
      entryId: "target",
    });
  });

  it("finds the entry for the subclass form (before: not found)", () => {
    expect(matcherFor("math.GT/0309136").match("1")[0]).toMatchObject({
      entryId: "third",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zotero-native citation overlay: arXiv tokens and their matches
// ─────────────────────────────────────────────────────────────────────────────

const BUILD_ID = [...AUDITED_ZOTERO_10_BUILD_IDS][0];

function makeNativeReader(store: object): object {
  const pdfDocument = { numPages: 1 };
  return {
    type: "pdf",
    itemID: 11,
    tabID: "tab-1",
    _window: {
      Zotero_Tabs: { selectedID: "tab-1" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      document: { hasFocus: () => true },
    },
    _internalReader: {
      _primaryView: {
        _iframe: {
          browsingContext: { id: 101 },
          contentWindow: { windowGlobalChild: { innerWindowId: 202 } },
        },
        _iframeWindow: {
          PDFViewerApplication: {
            pdfLoadingTask: { docId: "d0" },
            pdfDocument,
          },
        },
        _findController: { _pdfDocument: pdfDocument },
        _processedPageOverlays: store,
      },
    },
  };
}

/** Build the native package for one citation per reference text. */
function buildNativePackage(
  referenceTexts: string[],
): NativeOverlayMatchPackage {
  (globalThis as any).Services = {
    appinfo: { version: "10.0", appBuildID: BUILD_ID },
  };
  (globalThis as any).Cu = {
    waiveXrays: (value: unknown) => value,
    unwaiveXrays: (value: unknown) => value,
  };
  const store = {
    0: referenceTexts.map((text, index) => {
      const label = String(index + 1);
      return {
        type: "citation",
        word: Array.from(label, (c) => ({ c })),
        references: [{ index: index + 1, text }],
      };
    }),
  };
  const reader = makeNativeReader(store);
  const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
  const inspection = adapter.inspect(reader);
  if (inspection.kind !== "ready") throw new Error("fixture must be ready");
  const state = createNativeOverlayBuildState(inspection.tuple, 1);
  for (let slice = 0; slice < 2_000; slice++) {
    const result = runNativeOverlayBuildSlice(
      adapter,
      reader,
      state,
      () => 0,
      1,
    );
    if (result.kind === "progress") continue;
    if (result.kind !== "complete" || !result.package) {
      throw new Error("fixture must build a package");
    }
    return result.package;
  }
  throw new Error("build did not finish");
}

describe("native overlay arXiv tokens", () => {
  const texts = [
    "A. Author, Title one, arXiv:2301.12345 [hep-ph].",
    "B. Author, Title two, arXiv:2301.12345v2 [hep-ph].",
    "C. Author, Title three, arXiv: hep-ph/0101001.",
    "D. Author, Title four, arXiv:math.GT/0309136.",
    "E. Author, Title five, arXiv:1501.0123 [hep-ph].",
    "F. Author, Title six, arXiv:2301.12345.",
    "G. Author, Title seven, arXiv:2313.12345 [hep-ph].",
    "H. Author, Title eight, arXiv:2301.1 [hep-ph].",
  ];

  it("records the normalized arXiv ID of each reference", () => {
    const nativePackage = buildNativePackage(texts);
    const arxivByLabel = texts.map(
      (_, index) =>
        nativePackage.tokenMap.get(String(index + 1))?.[0]?.arxiv ?? null,
    );
    // Before, the last four references kept what the token pattern captured:
    // "1501.0123", "2301.12345.", "2313.12345" and "2301.1"; none of these
    // could match an INSPIRE entry, so the matches below are unchanged
    expect(arxivByLabel).toEqual([
      "2301.12345",
      "2301.12345",
      "hep-ph/0101001",
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("matches a label to the entry with the same arXiv ID", () => {
    const nativePackage = buildNativePackage(texts);
    const matcher = new LabelMatcher(
      [
        entry("a", { id: "2301.12345" }),
        entry("c", { id: "hep-ph/0101001" }),
        entry("e", { id: "1501.01234" }),
        entry("d", { id: "math/0309136" }),
      ],
      7301,
    );
    const matched = (label: string) =>
      matcher
        .match(label, nativePackage)
        .filter((result) => result.matchedIdentifier?.type === "arxiv")
        .map((result) => [result.entryId, result.matchedIdentifier?.value]);
    expect(matched("1")).toEqual([["a", "2301.12345"]]);
    expect(matched("2")).toEqual([["a", "2301.12345"]]);
    expect(matched("3")).toEqual([["c", "hep-ph/0101001"]]);
    expect(matched("4")).toEqual([]);
    expect(matched("5")).toEqual([]);
    expect(matched("6")).toEqual([]);
  });
});
