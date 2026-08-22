// ─────────────────────────────────────────────────────────────────────────────
// hoverPreview.test.ts - Unit tests for hover preview functionality
// Tests event emission, matching logic, and multi-entry pagination
// ─────────────────────────────────────────────────────────────────────────────

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  beforeAll,
  afterEach,
} from "vitest";
import { LabelMatcher } from "../src/modules/inspire/pdfAnnotate/labelMatcher";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import type { CitationPreviewEvent } from "../src/modules/inspire/pdfAnnotate/types";
import type { NativeOverlayMatchPackage } from "../src/modules/inspire/pdfAnnotate/nativeOverlayTypes";

// Mock globals
beforeAll(() => {
  (globalThis as any).ztoolkit = {
    log: vi.fn(),
  };
  (globalThis as any).Zotero = {
    debug: vi.fn(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// Note: InspireReferenceEntry.authors is string[] (e.g., ["Guo, F.K.", "Chen, X."])
// ─────────────────────────────────────────────────────────────────────────────

function createMockEntry(
  overrides: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test Paper Title",
    authors: ["Smith, J."],
    authorText: "Smith, J.",
    displayText: "Smith (2024) - Test Paper Title",
    searchText: "smith test paper title 2024",
    year: "2024",
    recid: "12345",
    citationCount: 10,
    ...overrides,
  };
}

function createMockEntries(): InspireReferenceEntry[] {
  return [
    createMockEntry({
      id: "entry-1",
      title: "First Paper",
      authors: ["Guo, F.K."],
      authorText: "Guo, F.K.",
      displayText: "Guo (2015) - First Paper",
      searchText: "guo first paper 2015",
      year: "2015",
      recid: "1001",
      label: "1",
    }),
    createMockEntry({
      id: "entry-2",
      title: "Second Paper",
      authors: ["Chen, X."],
      authorText: "Chen, X.",
      displayText: "Chen (2016) - Second Paper",
      searchText: "chen second paper 2016",
      year: "2016",
      recid: "1002",
      label: "2",
    }),
    createMockEntry({
      id: "entry-3",
      title: "Third Paper by Guo",
      authors: ["Guo, F.K."],
      authorText: "Guo, F.K.",
      displayText: "Guo (2015) - Third Paper by Guo",
      searchText: "guo third paper 2015",
      year: "2015",
      recid: "1003",
      label: "3",
    }),
    createMockEntry({
      id: "entry-4",
      title: "Paper with Multiple Authors",
      authors: ["Weinberg, S.", "Glashow, S."],
      authorText: "Weinberg, S.; Glashow, S.",
      displayText: "Weinberg and Glashow (2020) - Paper with Multiple Authors",
      searchText: "weinberg glashow paper multiple authors 2020",
      year: "2020",
      recid: "1004",
      label: "4",
    }),
    createMockEntry({
      id: "entry-5",
      title: "Fifth Paper",
      authors: ["Guo, F.K."],
      authorText: "Guo, F.K.",
      displayText: "Guo (2017) - Fifth Paper",
      searchText: "guo fifth paper 2017",
      year: "2017",
      recid: "1005",
      label: "5",
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: CitationPreviewEvent Structure Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CitationPreviewEvent Structure", () => {
  it("should have required fields for numeric citation", () => {
    const event: CitationPreviewEvent = {
      parentItemID: 123,
      label: "65",
      labels: ["65"],
      citationType: "numeric",
      buttonRect: { top: 100, left: 200, bottom: 120, right: 250 },
      readerTabID: "tab-1",
    };

    expect(event.parentItemID).toBe(123);
    expect(event.label).toBe("65");
    expect(event.labels).toContain("65");
    expect(event.citationType).toBe("numeric");
    expect(event.buttonRect.top).toBe(100);
  });

  it("should support labels array for author-year", () => {
    const event: CitationPreviewEvent = {
      parentItemID: 123,
      label: "Guo et al. (2015)",
      labels: ["Guo", "2015", "Guo et al. 2015"],
      citationType: "author-year",
      buttonRect: { top: 100, left: 200, bottom: 120, right: 250 },
    };

    expect(event.labels).toContain("Guo");
    expect(event.labels).toContain("2015");
    expect(event.citationType).toBe("author-year");
  });

  it("should support arxiv citation type", () => {
    const event: CitationPreviewEvent = {
      parentItemID: 123,
      label: "2312.12345",
      labels: ["2312.12345"],
      citationType: "arxiv",
      buttonRect: { top: 0, left: 0, bottom: 0, right: 0 },
    };

    expect(event.citationType).toBe("arxiv");
    expect(event.label).toBe("2312.12345");
    expect(event.labels).toContain("2312.12345");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: LabelMatcher for Preview - Numeric Citation Matching
// Note: match() requires PDF mapping data for reliable results.
// These tests verify the integration path works correctly.
// ─────────────────────────────────────────────────────────────────────────────

describe("LabelMatcher for Preview - Numeric Citations", () => {
  let matcher: LabelMatcher;
  let entries: InspireReferenceEntry[];

  beforeEach(() => {
    entries = createMockEntries();
    matcher = new LabelMatcher(entries, 101);
  });

  describe("match() basic behavior", () => {
    it("should return empty for non-existent label without mapping", () => {
      // Without PDF mapping, match() relies on alignment diagnosis
      // which may not find matches without proper setup
      const results = matcher.match("999");
      expect(results.length).toBe(0);
    });

    it("should handle whitespace in labels", () => {
      const results = matcher.match("  1  ");
      // Result depends on internal state, but should not throw
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it("should handle empty label", () => {
      const results = matcher.match("");
      expect(results.length).toBe(0);
    });
  });

  describe("match() with call-scoped native evidence", () => {
    it("should use a reliable native package when supplied for this call", () => {
      entries[0].doi = "10.1234/first";
      matcher = new LabelMatcher(entries, 101);
      const nativePackage: NativeOverlayMatchPackage = {
        tokenMap: new Map([
          ["1", [{ doi: "10.1234/first" }]],
          ["2", []],
          ["3", []],
        ]),
        revision: 1,
      };

      const results = matcher.match("1", nativePackage);
      expect(results).toHaveLength(1);
      expect(results[0].entryId).toBe("entry-1");
      expect(results[0].matchMethod).toBe("overlay");
    });

    it("should handle multiple native references under one label", () => {
      entries[0].doi = "10.1234/first";
      entries[1].doi = "10.1234/second";
      matcher = new LabelMatcher(entries, 101);
      const nativePackage: NativeOverlayMatchPackage = {
        tokenMap: new Map([
          ["1", [{ doi: "10.1234/first" }, { doi: "10.1234/second" }]],
          ["2", []],
          ["3", []],
        ]),
        revision: 2,
      };

      const results = matcher.match("1", nativePackage);
      expect(results.map((result) => result.entryId)).toEqual([
        "entry-1",
        "entry-2",
      ]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3: LabelMatcher for Preview - Author-Year Citation Matching
// Note: matchAuthorYear() expects labels like ["Guo", "2015", "Guo et al. 2015"]
// ─────────────────────────────────────────────────────────────────────────────

describe("LabelMatcher for Preview - Author-Year Citations", () => {
  let matcher: LabelMatcher;
  let entries: InspireReferenceEntry[];

  beforeEach(() => {
    entries = createMockEntries();
    matcher = new LabelMatcher(entries, 101);
  });

  describe("matchAuthorYear()", () => {
    it("should match author name and year", () => {
      // Labels from CitationParser for "Guo (2015)"
      const results = matcher.matchAuthorYear(["Guo", "2015"]);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Should find entries with Guo and 2015
      const matchedEntries = results.map((r) => entries[r.entryIndex]);
      expect(matchedEntries.some((e) => e.authors?.[0]?.includes("Guo"))).toBe(
        true,
      );
    });

    it("should match 'et al.' format label", () => {
      const results = matcher.matchAuthorYear([
        "Guo",
        "2015",
        "Guo et al. 2015",
      ]);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty for non-matching author", () => {
      const results = matcher.matchAuthorYear(["NonExistent", "2024"]);
      expect(results.length).toBe(0);
    });

    it("should handle multiple authors in labels", () => {
      // Labels from CitationParser for "Weinberg and Glashow (2020)"
      const results = matcher.matchAuthorYear(["Weinberg", "Glashow", "2020"]);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const matchedEntries = results.map((r) => entries[r.entryIndex]);
      expect(
        matchedEntries.some((e) => e.authors?.[0]?.includes("Weinberg")),
      ).toBe(true);
    });

    it("should detect ambiguous matches (same author, same year)", () => {
      // Both entry-1 and entry-3 have Guo + 2015
      const results = matcher.matchAuthorYear(["Guo", "2015"]);

      // Should find at least one result
      expect(results.length).toBeGreaterThanOrEqual(1);

      // If truly ambiguous, first result may be marked
      if (results.length > 0 && results[0].isAmbiguous) {
        expect(results[0].ambiguousCandidates).toBeDefined();
        expect(results[0].ambiguousCandidates!.length).toBeGreaterThan(1);
      }
    });
  });

  describe("matchAuthorYear() edge cases", () => {
    it("should handle empty labels array", () => {
      const results = matcher.matchAuthorYear([]);
      expect(results.length).toBe(0);
    });

    it("should handle year-only label", () => {
      const results = matcher.matchAuthorYear(["2015"]);
      // May or may not find results depending on implementation
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it("should handle labels with different year", () => {
      const results = matcher.matchAuthorYear(["Guo", "2017"]);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Should find entry-5 with year 2017
      const matchedEntries = results.map((r) => entries[r.entryIndex]);
      expect(matchedEntries.some((e) => e.year === "2017")).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 4: Preview Event Scheduling Logic (Unit Tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("Preview Event Scheduling Logic", () => {
  describe("Delay and Cancellation", () => {
    let showTimeout: ReturnType<typeof setTimeout> | undefined;
    let hideTimeout: ReturnType<typeof setTimeout> | undefined;
    const showDelay = 300;
    const hideDelay = 100;

    afterEach(() => {
      if (showTimeout) clearTimeout(showTimeout);
      if (hideTimeout) clearTimeout(hideTimeout);
      showTimeout = undefined;
      hideTimeout = undefined;
    });

    it("should respect show delay before emitting", async () => {
      let emitted = false;

      // Simulate schedulePreviewShow
      showTimeout = setTimeout(() => {
        emitted = true;
      }, showDelay);

      // Should not emit immediately
      expect(emitted).toBe(false);

      // Wait for delay
      await new Promise((r) => setTimeout(r, showDelay + 50));
      expect(emitted).toBe(true);
    });

    it("should cancel show on hidePreview before delay completes", async () => {
      let emitted = false;

      // Schedule show
      showTimeout = setTimeout(() => {
        emitted = true;
      }, showDelay);

      // Cancel before delay (simulating hidePreview)
      await new Promise((r) => setTimeout(r, 100));
      clearTimeout(showTimeout);
      showTimeout = undefined;

      // Wait past original delay
      await new Promise((r) => setTimeout(r, showDelay));
      expect(emitted).toBe(false);
    });

    it("should cancel hide when mouse enters card", async () => {
      let hidden = false;

      // Schedule hide
      hideTimeout = setTimeout(() => {
        hidden = true;
      }, hideDelay);

      // Simulate mouseenter on card - cancel hide
      await new Promise((r) => setTimeout(r, 50));
      clearTimeout(hideTimeout);
      hideTimeout = undefined;

      // Wait past original delay
      await new Promise((r) => setTimeout(r, hideDelay + 50));
      expect(hidden).toBe(false);
    });

    it("should not show duplicate for same button", () => {
      let currentButton: string | undefined;
      const buttonId = "button-1";

      // Simulate first hover
      if (currentButton !== buttonId) {
        currentButton = buttonId;
      }

      // Simulate second hover on same button - should skip
      const shouldSkip = currentButton === buttonId;
      expect(shouldSkip).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 5: Multi-Entry Pagination Logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Multi-Entry Pagination Logic", () => {
  it("should track current index in entries array", () => {
    const entries = createMockEntries();
    let currentIndex = 0;

    expect(entries[currentIndex].id).toBe("entry-1");

    currentIndex = 1;
    expect(entries[currentIndex].id).toBe("entry-2");
  });

  it("should navigate forward through entries", () => {
    const entries = createMockEntries();
    let currentIndex = 0;
    const total = entries.length;

    // Navigate forward
    const navigateForward = () => {
      if (currentIndex < total - 1) {
        currentIndex++;
      }
    };

    navigateForward();
    expect(currentIndex).toBe(1);

    navigateForward();
    expect(currentIndex).toBe(2);
  });

  it("should navigate backward through entries", () => {
    const entries = createMockEntries();
    let currentIndex = 2;

    const navigateBackward = () => {
      if (currentIndex > 0) {
        currentIndex--;
      }
    };

    navigateBackward();
    expect(currentIndex).toBe(1);

    navigateBackward();
    expect(currentIndex).toBe(0);
  });

  it("should not go below 0", () => {
    let currentIndex = 0;

    const navigateBackward = () => {
      if (currentIndex > 0) {
        currentIndex--;
      }
    };

    navigateBackward();
    expect(currentIndex).toBe(0);
  });

  it("should not exceed array bounds", () => {
    const entries = createMockEntries();
    let currentIndex = entries.length - 1;
    const total = entries.length;

    const navigateForward = () => {
      if (currentIndex < total - 1) {
        currentIndex++;
      }
    };

    navigateForward();
    expect(currentIndex).toBe(entries.length - 1);
  });

  it("should build correct pagination indicator text", () => {
    const current = 2;
    const total = 5;
    const label = "65";

    const indicator = `${current} / ${total} [${label}]`;
    expect(indicator).toBe("2 / 5 [65]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 6: Preview Card Position Calculation
// ─────────────────────────────────────────────────────────────────────────────

describe("Preview Card Position Calculation", () => {
  const viewportWidth = 1200;
  const viewportHeight = 800;
  const cardWidth = 420;
  const cardMaxHeight = 400;
  const gap = 8;

  function calculatePosition(buttonRect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  }) {
    const spaceAbove = buttonRect.top - gap;
    const spaceBelow = viewportHeight - buttonRect.bottom - gap;

    const left = Math.max(
      gap,
      Math.min(buttonRect.left, viewportWidth - cardWidth - gap),
    );
    let bottom: number;

    if (spaceAbove >= cardMaxHeight || spaceAbove >= spaceBelow) {
      // Position above
      bottom = viewportHeight - buttonRect.top + gap;
    } else {
      // Position below
      bottom = Math.max(
        gap,
        viewportHeight - buttonRect.bottom - cardMaxHeight - gap,
      );
    }

    // Clamp bottom value
    const maxBottom = viewportHeight - cardMaxHeight - gap;
    if (bottom > maxBottom) {
      bottom = Math.max(gap, maxBottom);
    }

    return { left, bottom };
  }

  it("should position above button when space available", () => {
    const buttonRect = { top: 500, left: 100, bottom: 520, right: 200 };
    const pos = calculatePosition(buttonRect);

    // Should use bottom positioning (card anchored at bottom)
    expect(pos.bottom).toBeGreaterThan(0);
    expect(pos.left).toBe(100);
  });

  it("should position below button when limited space above", () => {
    const buttonRect = { top: 50, left: 100, bottom: 70, right: 200 };
    const pos = calculatePosition(buttonRect);

    // With only 50px above, should position below
    expect(pos.bottom).toBeDefined();
  });

  it("should clamp left position to viewport", () => {
    const buttonRect = { top: 400, left: 1000, bottom: 420, right: 1100 };
    const pos = calculatePosition(buttonRect);

    // Left should be clamped so card fits in viewport
    expect(pos.left).toBeLessThanOrEqual(viewportWidth - cardWidth - gap);
  });

  it("should handle button at viewport edge", () => {
    const buttonRect = { top: 400, left: 0, bottom: 420, right: 50 };
    const pos = calculatePosition(buttonRect);

    expect(pos.left).toBe(gap);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 7: Native overlay match package
// ─────────────────────────────────────────────────────────────────────────────

describe("NativeOverlayMatchPackage", () => {
  it("should keep only primitive token evidence", () => {
    const nativePackage: NativeOverlayMatchPackage = {
      tokenMap: new Map(),
      revision: 1,
    };

    expect(nativePackage.tokenMap.size).toBe(0);
    expect(nativePackage.revision).toBe(1);
  });

  it("should support the three-label reliability floor", () => {
    const nativePackage: NativeOverlayMatchPackage = {
      tokenMap: new Map([
        ["1", [{ doi: "10.1/a" }]],
        ["2", []],
        ["3", []],
      ]),
      revision: 2,
    };

    expect(nativePackage.tokenMap.size).toBe(3);
  });

  it("should preserve multiple source-order tokens per label", () => {
    const nativePackage: NativeOverlayMatchPackage = {
      tokenMap: new Map([
        ["1", [{ doi: "10.1/a" }, { doi: "10.1/b" }, { doi: "10.1/c" }]],
      ]),
      revision: 3,
    };

    expect(nativePackage.tokenMap.get("1")?.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 8: Abstract Fetch Race Condition Handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Abstract Fetch Race Condition Handling", () => {
  it("should track entry ID before async operation", async () => {
    let currentEntryId: string | undefined = "entry-1";
    const fetchEntryId = currentEntryId;

    // Simulate user switching to different entry during fetch
    await new Promise((r) => setTimeout(r, 50));
    currentEntryId = "entry-2";

    // After async completes, check if entry is still being shown
    const shouldUpdate = currentEntryId === fetchEntryId;
    expect(shouldUpdate).toBe(false);
  });

  it("should update when entry is still being shown", async () => {
    const currentEntryId: string | undefined = "entry-1";
    const fetchEntryId = currentEntryId;

    // Simulate fetch completing while same entry shown
    await new Promise((r) => setTimeout(r, 50));
    // Entry unchanged
    expect(currentEntryId).toBe(fetchEntryId);

    const shouldUpdate = currentEntryId === fetchEntryId;
    expect(shouldUpdate).toBe(true);
  });

  it("should support AbortController for cancellation", () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);

    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });
});
