import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LabelMatcher } from "../src/modules/inspire/pdfAnnotate/labelMatcher";
import {
  NativeLinkedReferenceResolver,
  extractLinkedReferenceText,
  linkedReferenceIsInconclusive,
  settleLinkedReferenceWithin,
  shouldTrustLinkedReferenceForStrictMatch,
} from "../src/modules/inspire/pdfAnnotate/nativeLinkedReference";
import {
  PDFReferencesParser,
  type PDFPaperInfo,
} from "../src/modules/inspire/pdfAnnotate/pdfReferencesParser";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

const PROFILE = {
  status: "audited-zotero-10" as const,
  version: "10.0",
  buildID: "20260817111755",
};

beforeEach(() => {
  (globalThis as any).Cu = {
    waiveXrays: (value: unknown) => value,
    unwaiveXrays: (value: unknown) => value,
  };
  (globalThis as any).Zotero = { debug: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Zotero-native linked reference", () => {
  it("bounds a stalled target-page load without cancelling its later result", async () => {
    vi.useFakeTimers();
    let finish!: (value: {
      kind: "resolved";
      label: string;
      text: string;
      source: "link-target";
    }) => void;
    const source = new Promise<{
      kind: "resolved";
      label: string;
      text: string;
      source: "link-target";
    }>((resolve) => {
      finish = resolve;
    });

    const bounded = settleLinkedReferenceWithin(source, 200);
    await vi.advanceTimersByTimeAsync(200);
    await expect(bounded).resolves.toBeUndefined();

    finish({
      kind: "resolved",
      label: "27",
      text: "[27] R. B. Davies",
      source: "link-target",
    });
    await expect(source).resolves.toMatchObject({
      kind: "resolved",
      label: "27",
    });
  });

  it("reuses Zotero's exact citation-overlay text without loading a target page", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            index: 26,
            text: "[26] E. Gross and O. Vitells, Eur. Phys. J. C70, 525 (2010).",
          },
          {
            index: 27,
            text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
          },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "resolved",
      label: "27",
      text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
      source: "citation-overlay",
    });
    expect(fixture.primary.ensureCalls).toBe(0);
  });

  it("accepts a zero-padded printed marker for the same positive label", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            index: 27,
            text: "[027] R. B. Davies, Biometrika 74, 33 (1987).",
          },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "resolved",
      label: "27",
      text: "[027] R. B. Davies, Biometrika 74, 33 (1987).",
      source: "citation-overlay",
    });
  });

  it("rejects an indexed native record whose printed marker disagrees", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            index: 27,
            text: "[26] E. Gross and O. Vitells, Eur. Phys. J. C70, 525 (2010).",
          },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toEqual({ kind: "unresolved", label: "27" });
  });

  it("selects one indexed record from a large grouped native citation", async () => {
    const fixture = makeReaderFixture();
    const references = Array.from({ length: 64 }, (_, offset) => {
      const index = offset + 1;
      return {
        index,
        text:
          index === 27
            ? "[27] R. B. Davies, Biometrika 74, 33 (1987)."
            : `[${index}] ${"bounded grouped reference ".repeat(6)}`,
      };
    });
    expect(
      references.reduce((total, reference) => total + reference.text.length, 0),
    ).toBeGreaterThan(4_000);
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references,
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "resolved",
      label: "27",
      text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
      source: "citation-overlay",
    });
    expect(fixture.primary.ensureCalls).toBe(0);
  });

  it("accepts one unindexed native reference as an unambiguous exact target", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
          },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;
    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "resolved",
      label: "27",
      text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
      source: "citation-overlay",
    });
    expect(fixture.primary.ensureCalls).toBe(0);
  });

  it("declines a grouped citation overlay whose references have no indexes", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          { text: "[26] E. Gross and O. Vitells" },
          { text: "[27] R. B. Davies" },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toEqual({ kind: "unresolved", label: "27" });
    expect(fixture.primary.ensureCalls).toBe(0);
  });

  it("treats missing or empty citation references as no native evidence", () => {
    for (const citation of [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
      },
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [],
      },
    ]) {
      const fixture = makeReaderFixture();
      fixture.primary._pdfPages[650].overlays = [citation];
      const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
      expect(
        resolver.capture(
          fixture.reader,
          13501,
          { pageIndex: 650, rects: [[10, 10, 40, 20]] },
          "27",
        ),
      ).toBeUndefined();
    }
  });

  it("falls back to one linked page when grouped citation text is ambiguous", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays.unshift({
      type: "citation",
      position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
      references: [
        { text: "[26] E. Gross and O. Vitells" },
        { text: "[27] R. B. Davies" },
      ],
    });
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;
    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual(
      expect.objectContaining({
        kind: "resolved",
        label: "27",
        source: "link-target",
      }),
    );
    expect(fixture.primary.ensureCalls).toBe(1);
  });

  it("treats a single native reference indexed to another label as no evidence", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [{ index: 26, text: "[26] E. Gross and O. Vitells" }],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toBeUndefined();
  });

  it("treats mixed indexed and unindexed other labels as no evidence", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          { index: 26, text: "[26] E. Gross and O. Vitells" },
          { text: "[28] J. Skilling" },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toBeUndefined();
  });

  it("keeps a mixed unindexed target ambiguous", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          { index: 26, text: "[26] E. Gross and O. Vitells" },
          { text: "[27] R. B. Davies" },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toEqual({ kind: "unresolved", label: "27" });
  });

  it("declines duplicate native references carrying the same requested index", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          { index: 27, text: "[27] First chapter record" },
          { index: 27, text: "[27] Second chapter record" },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toEqual({ kind: "unresolved", label: "27" });
  });

  it("fails closed when intersecting citation records exceed the capture budget", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = Array.from(
      { length: 257 },
      () => ({
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [{ index: 27, text: "[27] bounded record" }],
      }),
    );
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toEqual({ kind: "unresolved", label: "27" });
  });

  it("does not admit touching rectangles or non-canonical numeric labels", () => {
    const fixture = makeReaderFixture();
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[35, 10, 45, 20]] },
        "27",
      ),
    ).toBeUndefined();
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "027",
      ),
    ).toBeUndefined();
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "0",
      ),
    ).toBeUndefined();
  });

  it("treats a single unindexed record carrying another marker as no evidence", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            text: "[26] E. Gross and O. Vitells, Eur. Phys. J. C70, 525 (2010).",
          },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toBeUndefined();
  });

  it("accepts an indexed native record with a space-separated printed marker", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            index: 27,
            text: "27 R. B. Davies, Biometrika 74, 33 (1987).",
          },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;
    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "resolved",
      label: "27",
      text: "27 R. B. Davies, Biometrika 74, 33 (1987).",
      source: "citation-overlay",
    });
    expect(fixture.primary.ensureCalls).toBe(0);
  });

  it("treats an indexed record without a recognized leading marker as no evidence", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays = [
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            index: 27,
            text: "R. B. Davies, Biometrika 74, 33 (1987).",
          },
        ],
      },
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toBeUndefined();
  });

  it("accepts a 2,270-page PDF and loads only the linked target page", async () => {
    const fixture = makeReaderFixture();
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    const [first, second] = await Promise.all([
      resolver.resolve(fixture.reader, capture),
      resolver.resolve(fixture.reader, capture),
    ]);
    expect(fixture.primary.ensureCalls).toBe(1);
    expect(first).toEqual(second);
    expect(first.kind).toBe("resolved");
    if (first.kind === "resolved") {
      expect(first.source).toBe("link-target");
      expect(first.text).toContain("R. B. Davies");
      expect(first.text).toContain("Biometrika 74, 33 (1987)");
      expect(first.text).not.toContain("J. Skilling");
    }
  });

  it("loads a pre-created destination page whose chars are still empty", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[667] = { chars: [], overlays: [] };
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    const evidence = await resolver.resolve(fixture.reader, capture);
    expect(fixture.primary.ensureCalls).toBe(1);
    expect(evidence.kind).toBe("resolved");
    if (evidence.kind === "resolved") {
      expect(evidence.source).toBe("link-target");
      expect(evidence.text).toContain("R. B. Davies");
    }
  });

  it("prefers a marker-local link over a conflicting global citation record", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays.push({
      type: "citation",
      position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
      references: [
        {
          index: 27,
          text: "[27] M. Hoferichter et al., JHEP 08 (2019) 137.",
        },
      ],
    });
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "resolved",
      label: "27",
      text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
      source: "link-target",
    });
    expect(fixture.primary.ensureCalls).toBe(1);
  });

  it("finds Zotero's page loader through a bounded prototype chain", async () => {
    const fixture = makeReaderFixture();
    const pageLoader = Object.getPrototypeOf(
      fixture.primary,
    )._ensureBasicPageData;
    const middlePrototype = Object.create({
      _ensureBasicPageData: pageLoader,
    });
    Object.setPrototypeOf(fixture.primary, middlePrototype);
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual(
      expect.objectContaining({ kind: "resolved", source: "link-target" }),
    );
    expect(fixture.primary.ensureCalls).toBe(1);
  });

  it("returns no evidence when a linked target page has no extractable text", async () => {
    const fixture = makeReaderFixture();
    (fixture.primary as any)._ensureBasicPageData = vi.fn(
      async (pageIndex: number) => {
        fixture.primary.ensureCalls++;
        fixture.primary._pdfPages[pageIndex] = { chars: [] };
      },
    );
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "no-evidence",
      label: "27",
    });
    expect(fixture.primary.ensureCalls).toBe(1);
  });

  it("keeps two vertically indistinguishable target markers unresolved", async () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[667] = {
      chars: [
        ...makeLine("[27] First possible target (1987).", 500),
        ...makeLine("[27] Second possible target (2019).", 506),
      ],
    };
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "unresolved",
      label: "27",
    });
    expect(fixture.primary.ensureCalls).toBe(0);
  });

  it("fails closed for two different native destinations", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays.push({
      type: "internal-link",
      position: { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      destinationPosition: { pageIndex: 668, rects: [[0, 300, 0, 300]] },
    });
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toEqual({ kind: "unresolved", label: "27" });
  });

  it("fails closed when one intersecting native target is malformed even if citation text exists", () => {
    const fixture = makeReaderFixture();
    fixture.primary._pdfPages[650].overlays.push(
      {
        type: "internal-link",
        position: { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        destinationPosition: {
          pageIndex: 9_999,
          rects: [[0, 300, 0, 300]],
        },
      },
      {
        type: "citation",
        position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
        references: [
          {
            index: 27,
            text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
          },
        ],
      },
    );
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    expect(
      resolver.capture(
        fixture.reader,
        13501,
        { pageIndex: 650, rects: [[10, 10, 40, 20]] },
        "27",
      ),
    ).toEqual({ kind: "unresolved", label: "27" });
  });

  it("revokes a captured target after the Reader document changes", async () => {
    const fixture = makeReaderFixture();
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;
    fixture.primary._iframeWindow.PDFViewerApplication.pdfDocument = {
      numPages: 2_270,
    };
    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "no-evidence",
      label: "27",
    });
    expect(fixture.primary.ensureCalls).toBe(0);
  });

  it("revokes a captured target when the resolver shuts down", async () => {
    const fixture = makeReaderFixture();
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;
    resolver.shutdown();
    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "no-evidence",
      label: "27",
    });
    expect(fixture.primary.ensureCalls).toBe(0);
  });
});

describe("strict target-text matching", () => {
  it("classifies unresolved and timed-out target evidence as inconclusive", () => {
    expect(linkedReferenceIsInconclusive(undefined)).toBe(false);
    expect(
      linkedReferenceIsInconclusive({ kind: "no-evidence", label: "27" }),
    ).toBe(false);
    expect(
      linkedReferenceIsInconclusive({ kind: "unresolved", label: "27" }),
    ).toBe(true);
    expect(
      linkedReferenceIsInconclusive({ kind: "timeout", label: "27" }),
    ).toBe(true);
    expect(
      linkedReferenceIsInconclusive({
        kind: "resolved",
        label: "27",
        text: "[27] R. B. Davies",
        source: "link-target",
      }),
    ).toBe(false);
  });

  it("trusts repeated labels only when evidence is marker-local", () => {
    const citationOverlay = {
      kind: "resolved" as const,
      label: "27",
      text: "[27] global record",
      source: "citation-overlay" as const,
    };
    const linkTarget = {
      ...citationOverlay,
      text: "[27] marker-local record",
      source: "link-target" as const,
    };

    expect(
      shouldTrustLinkedReferenceForStrictMatch(citationOverlay, false),
    ).toBe(true);
    expect(
      shouldTrustLinkedReferenceForStrictMatch(citationOverlay, true),
    ).toBe(false);
    expect(shouldTrustLinkedReferenceForStrictMatch(linkTarget, true)).toBe(
      true,
    );
  });

  it("selects Davies instead of another chapter's repeated label 27", () => {
    const entries: InspireReferenceEntry[] = [
      makeEntry({
        id: "wrong-jhep",
        title: "Three-pion contribution to hadronic vacuum polarization",
        authors: ["Hoferichter, Martin"],
        authorText: "Martin Hoferichter",
        year: "2019",
        label: "27",
        doi: "10.1007/JHEP08(2019)137",
        publicationInfo: {
          journal_title: "JHEP",
          journal_volume: "08",
          page_start: "137",
        },
      }),
      makeEntry({
        id: "correct-davies",
        title:
          "Hypothesis testing when a nuisance parameter is present only under the alternative",
        authors: ["Davies, Robert B."],
        authorText: "Robert B. Davies",
        year: "1987",
        label: "27",
        doi: "10.1093/biomet/74.1.33",
        publicationInfo: {
          journal_title: "Biometrika",
          journal_volume: "74",
          page_start: "33",
        },
      }),
    ];
    const parser = new PDFReferencesParser();
    const paperInfos = parser.parseReferenceText(
      "[27] R. B. Davies, Biometrika 74, 33 (1987).",
    );
    expect(paperInfos[0]).toMatchObject({
      firstAuthorLastName: "Davies",
      journalAbbrev: "Biometrika",
      volume: "74",
      pageStart: "33",
      year: "1987",
    });
    const matcher = new LabelMatcher(entries, 13501);
    expect(matcher.matchLinkedReference("27", paperInfos)).toMatchObject([
      { entryId: "correct-davies", matchMethod: "overlay" },
    ]);
  });

  it("returns no match when strong target metadata is duplicated", () => {
    const duplicate = makeEntry({
      id: "duplicate",
      authors: ["Davies, Robert B."],
      authorText: "Robert B. Davies",
      year: "1987",
      label: "27",
      publicationInfo: {
        journal_title: "Biometrika",
        journal_volume: "74",
        page_start: "33",
      },
    });
    const matcher = new LabelMatcher(
      [
        { ...duplicate, id: "first" },
        { ...duplicate, id: "second" },
      ],
      13501,
    );
    const infos = new PDFReferencesParser().parseReferenceText(
      "[27] R. B. Davies, Biometrika 74, 33 (1987).",
    );
    expect(matcher.matchLinkedReference("27", infos)).toEqual([]);
  });

  it("does not suppress the legacy matcher with a partial multi-paper result", () => {
    const matcher = new LabelMatcher(
      [
        makeEntry({
          id: "davies",
          label: "27",
          year: "1987",
          doi: "10.1093/biomet/74.1.33",
        }),
      ],
      13501,
    );
    const infos: PDFPaperInfo[] = [
      {
        rawText: "R. B. Davies, Biometrika 74, 33 (1987)",
        doi: "10.1093/biomet/74.1.33",
        year: "1987",
      },
      {
        rawText: "A second paper without a stable identifier",
        firstAuthorLastName: "Unknown",
        year: "1987",
      },
    ];
    expect(matcher.matchLinkedReference("27", infos)).toEqual([]);
  });

  it("fails closed when exact identifiers in one native record disagree", () => {
    const matcher = new LabelMatcher(
      [
        makeEntry({
          id: "arxiv-candidate",
          label: "27",
          arxivDetails: "1907.01556",
        }),
        makeEntry({
          id: "doi-candidate",
          label: "27",
          doi: "10.1093/biomet/74.1.33",
        }),
      ],
      13501,
    );
    expect(
      matcher.matchLinkedReference("27", [
        {
          rawText: "corrupt merged metadata",
          arxivId: "1907.01556",
          doi: "10.1093/biomet/74.1.33",
        },
      ]),
    ).toEqual([]);
  });

  it("matches exact native metadata in a 10,000-entry repeated-label list", () => {
    const entries = Array.from({ length: 10_000 }, (_, index) =>
      makeEntry({
        id: `entry-${index}`,
        label: String((index % 100) + 1),
        doi: `10.1234/review.${index}`,
      }),
    );
    const targetIndex = 9_876;
    const matcher = new LabelMatcher(entries, 13501);
    expect(matcher.hasDuplicateInspireLabels()).toBe(true);
    expect(matcher.getEntryAt(targetIndex)?.id).toBe(`entry-${targetIndex}`);
    expect(
      matcher.matchLinkedReference(String((targetIndex % 100) + 1), [
        {
          rawText: "exact Zotero citation-overlay record",
          doi: `10.1234/review.${targetIndex}`,
        },
      ]),
    ).toMatchObject([
      {
        entryIndex: targetIndex,
        entryId: `entry-${targetIndex}`,
        matchMethod: "overlay",
      },
    ]);
  });

  it("does not admit zero as a linked-reference label", () => {
    const matcher = new LabelMatcher(
      [makeEntry({ id: "zero", label: "0", doi: "10.1234/zero" })],
      13501,
    );
    expect(
      matcher.matchLinkedReference("0", [
        { rawText: "zero", doi: "10.1234/zero" },
      ]),
    ).toEqual([]);
  });

  it("ignores an inline citation marker even when it is closer to the destination", () => {
    const chars = [
      ...makeLine("See [27] in the discussion.", 500),
      ...makeLine("[27] R. B. Davies, Biometrika 74, 33 (1987).", 400),
    ];
    expect(
      extractLinkedReferenceText(chars, "27", [[115, 500, 120, 508]]),
    ).toContain("R. B. Davies");
  });

  it.each(["[027]", "27.", "27)", "27 "])(
    "extracts a bibliography entry beginning with %s",
    (marker) => {
      const chars = makeLine(
        `${marker} R. B. Davies, Biometrika 74, 33 (1987).`,
        400,
      );
      expect(
        extractLinkedReferenceText(chars, "27", [[115, 400, 120, 408]]),
      ).toContain("R. B. Davies");
    },
  );

  it("does not truncate a soft-wrapped entry whose continuation starts with a page number", () => {
    const firstLine = makeLine("[27] R. B. Davies, Biometrika 74,", 400);
    firstLine[firstLine.length - 1].paragraphBreakAfter = false;
    const chars = [
      ...firstLine,
      ...makeLine("33 (1987).", 390),
      ...makeLine("[28] J. Skilling, Nested Sampling (2004).", 370),
    ];

    expect(
      extractLinkedReferenceText(chars, "27", [[100, 400, 103, 408]]),
    ).toBe("[27] R. B. Davies, Biometrika 74, 33 (1987).");
  });

  it("uses real vertical separation when the same marker appears twice", () => {
    const chars = [
      ...makeLine("[27] Correct reference (1987).", 400),
      ...makeLine("[27] Other reference (2019).", 410),
    ];

    expect(extractLinkedReferenceText(chars, "27", [[0, 400, 0, 400]])).toBe(
      "[27] Correct reference (1987).",
    );
  });

  it("checks the closest marker against every vertically ambiguous candidate", async () => {
    const fixture = makeReaderFixture();
    const sourceOverlay = fixture.primary._pdfPages[650].overlays[0];
    sourceOverlay.destinationPosition.rects = [[101.5, 400, 101.5, 400]];
    const horizontallyShifted = makeLine(
      "[27] Third ambiguous reference (2020).",
      407,
    ).map((char) => ({
      ...char,
      rect: [char.rect[0] + 72, char.rect[1], char.rect[2] + 72, char.rect[3]],
    }));
    fixture.targetPage.chars = [
      ...makeLine("[27] Nearest reference (1987).", 400),
      ...makeLine("[27] Second reference (2019).", 408),
      ...horizontallyShifted,
    ];
    const resolver = new NativeLinkedReferenceResolver(PROFILE, () => true);
    const capture = resolver.capture(
      fixture.reader,
      13501,
      { pageIndex: 650, rects: [[10, 10, 40, 20]] },
      "27",
    );
    expect(capture?.kind).toBe("linked");
    if (!capture) return;

    // Candidate 2 is exactly at the ambiguity threshold, but candidate 3 is
    // vertically closer and sorts later only because of horizontal distance.
    await expect(resolver.resolve(fixture.reader, capture)).resolves.toEqual({
      kind: "unresolved",
      label: "27",
    });
  });
});

class MockPrimaryView {
  ensureCalls = 0;
  _pdfPages: Record<number, any>;
  _iframeWindow: any;
  private readonly targetPage: any;

  constructor(pdfDocument: object, targetPage: any) {
    this.targetPage = targetPage;
    this._pdfPages = {
      650: {
        chars: [],
        overlays: [
          {
            type: "internal-link",
            position: { pageIndex: 650, rects: [[20, 10, 35, 20]] },
            destinationPosition: {
              pageIndex: 667,
              rects: [[0, 500, 0, 500]],
            },
          },
        ],
      },
    };
    this._iframeWindow = {
      PDFViewerApplication: { pdfDocument },
    };
  }

  async _ensureBasicPageData(pageIndex: number) {
    this.ensureCalls++;
    await Promise.resolve();
    this._pdfPages[pageIndex] = this.targetPage;
  }
}

function makeReaderFixture() {
  const pdfDocument = { numPages: 2_270 };
  const targetPage = {
    chars: [
      ...makeLine(
        "[26] E. Gross and O. Vitells, Eur. Phys. J. C70, 525 (2010).",
        520,
      ),
      ...makeLine("[27] R. B. Davies,", 500),
      ...makeLine("Biometrika 74, 33 (1987).", 490),
      ...makeLine("[28] J. Skilling, Nested Sampling, 735, 395 (2004).", 470),
    ],
    overlays: [],
  };
  const primary = new MockPrimaryView(pdfDocument, targetPage);
  const reader = {
    itemID: 13501,
    _internalReader: { _primaryView: primary },
  };
  return { reader, primary, targetPage };
}

function makeLine(text: string, y: number) {
  return Array.from(text, (c, index) => ({
    c,
    rect: [100 + index * 4, y, 103 + index * 4, y + 8],
    ignorable: false,
    spaceAfter: false,
    lineBreakAfter: index === text.length - 1,
    paragraphBreakAfter: index === text.length - 1,
  }));
}

function makeEntry(
  overrides: Partial<InspireReferenceEntry>,
): InspireReferenceEntry {
  return {
    id: "entry",
    recid: "1",
    title: "Paper",
    authors: [],
    year: "2024",
    ...overrides,
  } as InspireReferenceEntry;
}
