import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localCache } from "../src/modules/inspire/localCache";
import { LabelMatcher } from "../src/modules/inspire/pdfAnnotate/labelMatcher";
import {
  loadPersistedPdfParse,
  persistPdfParse,
} from "../src/modules/inspire/pdfAnnotate/pdfMappingPersistence";
import type { PDFReferenceMapping } from "../src/modules/inspire/pdfAnnotate/pdfReferencesParser";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { resolveMatchIndicesForDisplay } from "../src/modules/zinspire";

describe("persisted PDF mapping ordering", () => {
  let stored: unknown;

  beforeEach(() => {
    stored = undefined;
    (globalThis as any).Zotero = { debug: vi.fn() };
    (globalThis as any).IOUtils = {
      stat: vi.fn().mockResolvedValue({ lastModified: 1234, size: 5678 }),
    };
    vi.spyOn(localCache, "isEnabled").mockReturnValue(true);
    vi.spyOn(localCache, "set").mockImplementation(
      async (_type: any, _key: string, data: unknown) => {
        // Reproduce the JSON boundary crossed by the gzip disk cache. A live
        // object hand-off would not detect accidental Map/Set persistence.
        stored = JSON.parse(JSON.stringify(data));
      },
    );
    vi.spyOn(localCache, "get").mockImplementation(async () => ({
      data: stored,
      timestamp: Date.now(),
      ageHours: 0,
      isExpired: false,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips counts and rebuilds indices against canonical cache order", async () => {
    const mapping: PDFReferenceMapping = {
      parsedAt: 1000,
      labelCounts: new Map([
        ["1", 1],
        ["2", 2],
      ]),
      totalLabels: 2,
      confidence: "high",
    };
    await persistPdfParse("1-ATTACH", "/tmp/review.pdf", mapping, undefined);
    expect(Object.keys((stored as any).numeric).sort()).toEqual([
      "confidence",
      "labelCounts",
      "parsedAt",
      "totalLabels",
    ]);

    const restored = await loadPersistedPdfParse("1-ATTACH", "/tmp/review.pdf");
    expect(Array.from(restored?.numeric?.labelCounts ?? [])).toEqual([
      ["1", 1],
      ["2", 2],
    ]);

    const canonical = [
      { id: "first", label: "10" },
      { id: "second", label: "20" },
      { id: "third", label: "30" },
    ] as InspireReferenceEntry[];
    const displayed = [canonical[2], canonical[0], canonical[1]];
    const matcher = new LabelMatcher(canonical, 84);
    matcher.setPDFMapping(restored!.numeric!);
    expect((matcher as any).pdfLabelMap.get("2")).toEqual([1, 2]);

    const matches = matcher.match("2");
    expect(matches.map((match) => match.entryId)).toEqual(["second", "third"]);
    expect(resolveMatchIndicesForDisplay(matches, matcher, displayed)).toEqual([
      2, 0,
    ]);
  });
});
