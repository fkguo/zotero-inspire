// ─────────────────────────────────────────────────────────────────────────────
// fundingExtraction.test.ts - Funding extraction + filter regression tests
//
// The acknowledgment strings below are taken verbatim from real papers whose
// grant numbers previously failed to extract or filter, so these double as
// regression fixtures:
//   - "National Science Foundation of China" (the word "Natural" dropped)
//   - "National Key R&D Program of China" written in English
//   - the Chinese short form "重点研发计划" typed into the custom filter
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/prefs", () => ({
  getPref: vi.fn(),
}));

import { getPref } from "../src/utils/prefs";
import { extractFundingInfo } from "../src/modules/inspire/funding/fundingExtractor";
import {
  resolveCustomFunderIds,
  filterFunding,
} from "../src/modules/inspire/funding/fundingFilter";
import { FundingInfo } from "../src/modules/inspire/funding/types";
import { getFundingForItem } from "../src/modules/inspire/funding/fundingService";

/** Collect extracted grant numbers grouped by funder id. */
function grantsByFunder(text: string): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const f of extractFundingInfo(text)) {
    (out[f.funderId] ??= new Set()).add(f.grantNumber);
  }
  return out;
}

// Real acknowledgment (Huizhou Hadron Spectrometer, item CZJJNIFH).
// Writes NSFC as "National Science Foundation of China" — no "Natural".
const ACK_NSF_NO_NATURAL =
  "Supported by the CAS Project for Young Scientists in Basic Research " +
  "(No. YSBR-088), the National Science Foundation of China " +
  "(Nos. 12347103, 12435007, 12361141819, 12305145) and Chongqing Natural " +
  "Science Foundation (No. CSTB2025NSCQ-GPX0745).";

// Real acknowledgment (Effective Range Expansion, item AFQAAL54).
// NSFC full name + English "National Key R&D Program of China" + CAS.
const ACK_NSFC_MOST_CAS =
  "This work is supported in part by the National Natural Science Foundation " +
  "of China (NSFC) under Grants No. 12547111, No. 12125507, No. 12361141819, " +
  "and No. 12447101; by the National Key R&D Program of China under Grant " +
  "No. 2023YFA1606703; and by the Chinese Academy of Sciences under Grant " +
  "No. YSBR-101.";

describe("extractFundingInfo - NSFC full-name variants", () => {
  it("extracts NSFC when written 'National Science Foundation of China' (no 'Natural')", () => {
    const g = grantsByFunder(ACK_NSF_NO_NATURAL);
    expect(g.NSFC).toBeDefined();
    expect(g.NSFC).toEqual(
      new Set(["12347103", "12435007", "12361141819", "12305145"]),
    );
  });

  it("extracts NSFC when written with the correct full name + abbreviation", () => {
    const g = grantsByFunder(ACK_NSFC_MOST_CAS);
    expect(g.NSFC).toEqual(
      new Set(["12547111", "12125507", "12361141819", "12447101"]),
    );
  });

  it("does not misclassify NSFC full-name grants as the U.S. NSF", () => {
    // U.S. NSF grant numbers carry a letter prefix (e.g. PHY-1234567); the
    // pure-digit Chinese numbers here must never land under funder id "NSF".
    const g = grantsByFunder(ACK_NSF_NO_NATURAL);
    expect(g.NSF).toBeUndefined();
  });
});

describe("extractFundingInfo - National Key R&D Program (MoST)", () => {
  it("extracts the MoST grant from the English program name", () => {
    const g = grantsByFunder(ACK_NSFC_MOST_CAS);
    expect(g.MoST).toEqual(new Set(["2023YFA1606703"]));
  });

  it("extracts CAS (YSBR) alongside NSFC and MoST", () => {
    const g = grantsByFunder(ACK_NSFC_MOST_CAS);
    expect(g.CAS).toEqual(new Set(["YSBR-101"]));
  });
});

describe("resolveCustomFunderIds - abbreviation / full name / Chinese short form", () => {
  it("resolves the NSFC abbreviation to NSFC only", () => {
    expect([...resolveCustomFunderIds("NSFC")]).toEqual(["NSFC"]);
  });

  it("resolves 'MOST' to the Chinese MoST, not Taiwan's MOST", () => {
    expect([...resolveCustomFunderIds("MOST")]).toEqual(["MoST"]);
  });

  it("resolves the Chinese short form '重点研发计划' to MoST", () => {
    expect([...resolveCustomFunderIds("重点研发计划")]).toEqual(["MoST"]);
  });

  it("resolves '重点研发' (even shorter) to MoST", () => {
    expect([...resolveCustomFunderIds("重点研发")]).toEqual(["MoST"]);
  });

  it("resolves the full English program name to MoST", () => {
    expect([...resolveCustomFunderIds("National Key R&D Program of China")]).toEqual([
      "MoST",
    ]);
  });

  it("parses a comma/newline separated list", () => {
    const ids = resolveCustomFunderIds("NSFC, MoST\nCAS");
    expect(ids).toEqual(new Set(["NSFC", "MoST", "CAS"]));
  });

  it("returns an empty set for an unrecognized token", () => {
    expect(resolveCustomFunderIds("not-a-real-funder").size).toBe(0);
  });

  it("does not let a longer Chinese token match a shorter key (no reverse substring)", () => {
    // "台湾科技部" must not match the Chinese MoST alias "科技部".
    expect(resolveCustomFunderIds("台湾科技部").has("MoST")).toBe(false);
  });
});

describe("filterFunding - modes", () => {
  const sample: FundingInfo[] = [
    mk("NSFC", "12547111", "china"),
    mk("NSFC-DFG", "12061131006", "china"),
    mk("MoST", "2023YFA1606703", "china"),
    mk("CAS", "YSBR-101", "china"),
    mk("DOE", "DE-SC0015266", "us"),
  ];

  beforeEach(() => vi.mocked(getPref).mockReset());

  it("mode 'all' keeps every funder", () => {
    mockMode("all");
    expect(ids(filterFunding(sample))).toEqual([
      "NSFC",
      "NSFC-DFG",
      "MoST",
      "CAS",
      "DOE",
    ]);
  });

  it("mode 'china' drops non-Chinese funders", () => {
    mockMode("china");
    expect(ids(filterFunding(sample))).not.toContain("DOE");
    expect(ids(filterFunding(sample))).toContain("MoST");
  });

  it("mode 'nsfc' keeps NSFC and NSFC joint programs only", () => {
    mockMode("nsfc");
    expect(ids(filterFunding(sample))).toEqual(["NSFC", "NSFC-DFG"]);
  });

  it("mode 'custom' with '重点研发计划' keeps MoST only", () => {
    mockMode("custom", "重点研发计划");
    expect(ids(filterFunding(sample))).toEqual(["MoST"]);
  });

  it("mode 'custom' with an empty list does not hide everything", () => {
    mockMode("custom", "");
    expect(ids(filterFunding(sample))).toHaveLength(sample.length);
  });
});

// This plugin stores the INSPIRE recid in Archive Location (Archive "INSPIRE");
// it was once reported as the paper's arXiv ID.
describe("getFundingForItem - arXiv ID of the item", () => {
  beforeEach(() => mockMode("all"));

  it("does not report an INSPIRE recid in Archive Location as the arXiv ID", async () => {
    const result = await getFundingForItem(
      regularItemWithoutPdf(90001, {
        archive: "INSPIRE",
        archiveLocation: "1234567",
      }),
    );
    expect(result.source).toBe("none");
    expect(result.arxivId).toBeUndefined();
  });

  it("reports an arXiv ID marked in Archive Location", async () => {
    const result = await getFundingForItem(
      regularItemWithoutPdf(90002, { archiveLocation: "arXiv:2101.01234" }),
    );
    expect(result.arxivId).toBe("2101.01234");
  });

  // Intentional change: the export reads the same fields as preprint watch
  // (before, an arXiv ID only in Journal Abbr gave none)
  it("reads the arXiv ID of the legacy Journal Abbr layout", async () => {
    const result = await getFundingForItem(
      regularItemWithoutPdf(90003, {
        journalAbbreviation: "arXiv:2301.12345 [hep-ph]",
      }),
    );
    expect(result.arxivId).toBe("2301.12345");
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function mk(funderId: string, grantNumber: string, category: string): FundingInfo {
  return {
    funderId,
    funderName: funderId,
    grantNumber,
    confidence: 1,
    rawMatch: grantNumber,
    position: 0,
    category,
  };
}

function ids(list: FundingInfo[]): string[] {
  return list.map((f) => f.funderId);
}

function mockMode(mode: string, custom = "") {
  vi.mocked(getPref).mockImplementation((key: string) => {
    if (key === "funding_filter_mode") return mode;
    if (key === "funding_filter_custom") return custom;
    return undefined;
  });
}

/** Regular item with no attachment; absent fields read back as "". */
function regularItemWithoutPdf(
  id: number,
  fields: Record<string, string>,
): any {
  return {
    id,
    isPDFAttachment: () => false,
    isRegularItem: () => true,
    getBestAttachment: async () => null,
    getAttachments: () => [],
    getField: (field: string) => fields[field] ?? "",
  };
}
