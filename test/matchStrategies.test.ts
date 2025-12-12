// ─────────────────────────────────────────────────────────────────────────────
// matchStrategies.test.ts - Unit tests for PDF citation matching strategies
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  StrongIdentifierStrategy,
  VersionMismatchStrategy,
  PDFSequenceMappingStrategy,
  InspireLabelStrategy,
  IndexFallbackStrategy,
  FuzzyMatchStrategy,
  StrategyCoordinator,
  createDefaultCoordinator,
  type MatchContext,
  type MatchHelpers,
} from "../src/modules/inspire/pdfAnnotate/matchStrategies";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import type { AlignmentReport } from "../src/modules/inspire/pdfAnnotate/types";

// Helper to create a minimal entry for testing
function createEntry(overrides: Partial<InspireReferenceEntry> = {}): InspireReferenceEntry {
  return {
    id: "test-id",
    recid: 12345,
    label: "1",
    title: "Test Paper",
    authors: [],
    year: "2023",
    ...overrides,
  };
}

// Helper to create mock context
function createContext(overrides: Partial<MatchContext> = {}): MatchContext {
  const defaultHelpers: MatchHelpers = {
    calculateMatchScore: () => 0,
    getStrongMatchKind: () => null,
    normalizeArxivId: (id) => (typeof id === "string" ? id : null),
    normalizeDoi: (doi) => doi ?? null,
    getIndexMatchConfidence: () => "medium",
  };

  const defaultReport: AlignmentReport = {
    recommendation: "USE_INSPIRE_LABEL",
    alignRate: 1,
    issues: [],
  };

  return {
    pdfLabel: "1",
    normalizedLabel: "1",
    entries: [createEntry()],
    labelMap: new Map([["1", [0]]]),
    indexMap: new Map([[1, 0]]),
    alignmentReport: defaultReport,
    maxInspireLabel: 100,
    flags: {
      pdfMappingStrict: false,
      pdfOverParsed: false,
      pdfOverParsedRatio: 0,
      pdfMappingUsable: false,
      hasDuplicateLabels: false,
      preferPdfMapping: false,
      preferSeqMapping: false,
      overParsedActive: false,
      trustInspireLabels: true,
    },
    helpers: defaultHelpers,
    ...overrides,
  };
}

describe("StrongIdentifierStrategy", () => {
  const strategy = new StrongIdentifierStrategy();

  it("has correct name and priority", () => {
    expect(strategy.name).toBe("StrongIdentifier");
    expect(strategy.priority).toBe(100);
  });

  it("cannot handle when no paperInfos", () => {
    const ctx = createContext({ paperInfos: undefined });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("cannot handle when paperInfos empty", () => {
    const ctx = createContext({ paperInfos: [] });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("can handle when paperInfos present", () => {
    const ctx = createContext({
      paperInfos: [{ arxivId: "2301.12345" }],
    });
    expect(strategy.canHandle(ctx)).toBe(true);
  });

  it("returns empty results when no strong match found", () => {
    const ctx = createContext({
      paperInfos: [{ arxivId: "2301.12345" }],
    });
    const results = strategy.execute(ctx);
    expect(results).toEqual([]);
  });

  it("returns match when strong identifier matches", () => {
    const entry = createEntry({
      id: "matched-entry",
      arxivDetails: { id: "2301.12345", categories: [] },
    });
    const ctx = createContext({
      entries: [entry],
      paperInfos: [{ arxivId: "2301.12345" }],
      helpers: {
        ...createContext().helpers,
        getStrongMatchKind: () => ({ kind: "arxiv", score: 10 }),
        normalizeArxivId: () => "2301.12345",
      },
    });
    const results = strategy.execute(ctx);
    expect(results.length).toBe(1);
    expect(results[0].confidence).toBe("high");
    expect(results[0].matchMethod).toBe("exact");
  });
});

describe("VersionMismatchStrategy", () => {
  const strategy = new VersionMismatchStrategy();

  it("has correct name and priority", () => {
    expect(strategy.name).toBe("VersionMismatch");
    expect(strategy.priority).toBe(95);
  });

  it("cannot handle when label is within range", () => {
    const ctx = createContext({
      normalizedLabel: "50",
      maxInspireLabel: 100,
      paperInfos: [{ arxivId: "2301.12345" }],
    });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("cannot handle when no paperInfos", () => {
    const ctx = createContext({
      normalizedLabel: "150",
      maxInspireLabel: 100,
      paperInfos: undefined,
    });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("can handle when label exceeds max and has paperInfos", () => {
    const ctx = createContext({
      normalizedLabel: "150",
      maxInspireLabel: 100,
      paperInfos: [{ arxivId: "2301.12345" }],
    });
    expect(strategy.canHandle(ctx)).toBe(true);
  });

  it("returns match with version mismatch warning", () => {
    const entry = createEntry({
      id: "matched-entry",
      arxivDetails: { id: "2301.12345", categories: [] },
    });
    const ctx = createContext({
      pdfLabel: "150",
      normalizedLabel: "150",
      entries: [entry],
      maxInspireLabel: 100,
      paperInfos: [{ arxivId: "2301.12345" }],
      helpers: {
        ...createContext().helpers,
        normalizeArxivId: () => "2301.12345",
        normalizeDoi: () => null,
      },
    });
    const results = strategy.execute(ctx);
    expect(results.length).toBe(1);
    expect(results[0].versionMismatchWarning).toBeDefined();
    expect(results[0].versionMismatchWarning).toContain("150");
  });
});

describe("PDFSequenceMappingStrategy", () => {
  const strategy = new PDFSequenceMappingStrategy();

  it("has correct name and priority", () => {
    expect(strategy.name).toBe("PDFSequenceMapping");
    expect(strategy.priority).toBe(80);
  });

  it("cannot handle when no pdfLabelMap", () => {
    const ctx = createContext({
      pdfLabelMap: undefined,
      flags: { ...createContext().flags, preferSeqMapping: true },
    });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("cannot handle when not preferSeqMapping", () => {
    const ctx = createContext({
      pdfLabelMap: new Map([["1", [0]]]),
      flags: { ...createContext().flags, preferSeqMapping: false },
    });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("cannot handle when overParsedActive", () => {
    const ctx = createContext({
      pdfLabelMap: new Map([["1", [0]]]),
      flags: { ...createContext().flags, preferSeqMapping: true, overParsedActive: true },
    });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("can handle when conditions met", () => {
    const ctx = createContext({
      pdfLabelMap: new Map([["1", [0]]]),
      flags: { ...createContext().flags, preferSeqMapping: true, overParsedActive: false },
    });
    expect(strategy.canHandle(ctx)).toBe(true);
  });
});

describe("InspireLabelStrategy", () => {
  const strategy = new InspireLabelStrategy();

  it("has correct name and priority", () => {
    expect(strategy.name).toBe("InspireLabel");
    expect(strategy.priority).toBe(60);
  });

  it("can handle when not preferring PDF mapping", () => {
    const ctx = createContext({
      flags: { ...createContext().flags, preferPdfMapping: false },
    });
    expect(strategy.canHandle(ctx)).toBe(true);
  });

  it("returns match for exact label match", () => {
    const entry = createEntry({ id: "matched", label: "1" });
    const ctx = createContext({
      pdfLabel: "1",
      normalizedLabel: "1",
      entries: [entry],
      labelMap: new Map([["1", [0]]]),
    });
    const results = strategy.execute(ctx);
    expect(results.length).toBe(1);
    expect(results[0].entryId).toBe("matched");
    expect(results[0].confidence).toBe("high");
    expect(results[0].matchMethod).toBe("exact");
  });

  it("returns empty for non-matching label", () => {
    const ctx = createContext({
      normalizedLabel: "99",
      labelMap: new Map([["1", [0]]]),
    });
    const results = strategy.execute(ctx);
    expect(results).toEqual([]);
  });
});

describe("IndexFallbackStrategy", () => {
  const strategy = new IndexFallbackStrategy();

  it("has correct name and priority", () => {
    expect(strategy.name).toBe("IndexFallback");
    expect(strategy.priority).toBe(40);
  });

  it("cannot handle non-numeric label", () => {
    const ctx = createContext({ normalizedLabel: "Smith2023" });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("cannot handle label exceeding max", () => {
    const ctx = createContext({
      normalizedLabel: "150",
      maxInspireLabel: 100,
      indexMap: new Map([[150, 0]]),
    });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("cannot handle when index not in map", () => {
    const ctx = createContext({
      normalizedLabel: "50",
      maxInspireLabel: 100,
      indexMap: new Map([[1, 0]]),
    });
    expect(strategy.canHandle(ctx)).toBe(false);
  });

  it("can handle valid numeric label within range", () => {
    const ctx = createContext({
      normalizedLabel: "50",
      maxInspireLabel: 100,
      indexMap: new Map([[50, 0]]),
    });
    expect(strategy.canHandle(ctx)).toBe(true);
  });

  it("returns match using index mapping", () => {
    const entry = createEntry({ id: "indexed-entry", label: "5" });
    const ctx = createContext({
      pdfLabel: "5",
      normalizedLabel: "5",
      entries: [entry],
      indexMap: new Map([[5, 0]]),
      maxInspireLabel: 100,
    });
    const results = strategy.execute(ctx);
    expect(results.length).toBe(1);
    expect(results[0].entryId).toBe("indexed-entry");
  });
});

describe("FuzzyMatchStrategy", () => {
  const strategy = new FuzzyMatchStrategy();

  it("has correct name and priority", () => {
    expect(strategy.name).toBe("FuzzyMatch");
    expect(strategy.priority).toBe(20);
  });

  it("always can handle (last resort)", () => {
    const ctx = createContext();
    expect(strategy.canHandle(ctx)).toBe(true);
  });

  it("matches case-insensitive labels", () => {
    const entry = createEntry({ id: "fuzzy-match", label: "Smith2023" });
    const ctx = createContext({
      pdfLabel: "smith2023",
      normalizedLabel: "smith2023",
      entries: [entry],
      labelMap: new Map([["Smith2023", [0]]]),
    });
    const results = strategy.execute(ctx);
    expect(results.length).toBe(1);
    expect(results[0].entryId).toBe("fuzzy-match");
    expect(results[0].confidence).toBe("medium");
    expect(results[0].matchMethod).toBe("fuzzy");
  });

  it("returns empty for no match", () => {
    const ctx = createContext({
      normalizedLabel: "nomatch",
      labelMap: new Map([["Smith2023", [0]]]),
    });
    const results = strategy.execute(ctx);
    expect(results).toEqual([]);
  });
});

describe("StrategyCoordinator", () => {
  it("creates with default strategies sorted by priority", () => {
    const coordinator = createDefaultCoordinator();
    const strategies = coordinator.getStrategies();
    expect(strategies.length).toBe(7);
    // Verify sorted by priority descending
    for (let i = 1; i < strategies.length; i++) {
      expect(strategies[i - 1].priority).toBeGreaterThanOrEqual(strategies[i].priority);
    }
  });

  it("tries strategies in priority order", () => {
    const coordinator = new StrategyCoordinator();
    const entry = createEntry({ id: "test-entry", label: "1" });
    const ctx = createContext({
      pdfLabel: "1",
      normalizedLabel: "1",
      entries: [entry],
      labelMap: new Map([["1", [0]]]),
    });

    const results = coordinator.match(ctx);
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty array when no strategy matches", () => {
    const coordinator = new StrategyCoordinator();
    const ctx = createContext({
      pdfLabel: "nonexistent",
      normalizedLabel: "nonexistent",
      labelMap: new Map(),
      indexMap: new Map(),
    });

    const results = coordinator.match(ctx);
    expect(results).toEqual([]);
  });

  it("accepts custom strategies", () => {
    const customStrategy = {
      name: "Custom",
      priority: 1000, // highest
      canHandle: () => true,
      execute: () => [
        {
          pdfLabel: "custom",
          entryIndex: 0,
          entryId: "custom-id",
          confidence: "high" as const,
          matchMethod: "exact" as const,
        },
      ],
    };

    const coordinator = new StrategyCoordinator([customStrategy]);
    const ctx = createContext();
    const results = coordinator.match(ctx);

    expect(results.length).toBe(1);
    expect(results[0].entryId).toBe("custom-id");
  });
});
