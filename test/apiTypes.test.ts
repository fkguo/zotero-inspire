// ─────────────────────────────────────────────────────────────────────────────
// apiTypes.test.ts - Unit tests for API type guards and utilities
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  isInspireLiteratureSearchResponse,
  isInspireLiteratureHit,
  isCrossRefWorksResponse,
  extractRecidFromRef,
  getPrimaryTitle,
  getPrimaryArxivId,
  getPrimaryDoi,
  getPrimaryAbstract,
  type InspireLiteratureSearchResponse,
  type InspireLiteratureHit,
  type CrossRefWorksResponse,
  type InspireTitle,
  type InspireArxivEprint,
  type InspireDOI,
  type InspireAbstract,
  type InspireRecordRef,
} from "../src/modules/inspire/apiTypes";

describe("isInspireLiteratureSearchResponse", () => {
  it("returns true for valid response", () => {
    const response: InspireLiteratureSearchResponse = {
      hits: {
        total: 10,
        hits: [],
      },
    };
    expect(isInspireLiteratureSearchResponse(response)).toBe(true);
  });

  it("returns true for response with hits", () => {
    const response = {
      hits: {
        total: 1,
        hits: [
          {
            id: "123",
            created: "2024-01-01",
            updated: "2024-01-02",
            metadata: { control_number: 123, titles: [{ title: "Test" }] },
          },
        ],
      },
    };
    expect(isInspireLiteratureSearchResponse(response)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isInspireLiteratureSearchResponse(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isInspireLiteratureSearchResponse(undefined)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isInspireLiteratureSearchResponse("string")).toBe(false);
    expect(isInspireLiteratureSearchResponse(123)).toBe(false);
  });

  it("returns false for missing hits", () => {
    expect(isInspireLiteratureSearchResponse({})).toBe(false);
  });

  it("returns false for missing total", () => {
    expect(isInspireLiteratureSearchResponse({ hits: { hits: [] } })).toBe(false);
  });

  it("returns false for non-array hits", () => {
    expect(
      isInspireLiteratureSearchResponse({ hits: { total: 1, hits: "not array" } })
    ).toBe(false);
  });
});

describe("isInspireLiteratureHit", () => {
  it("returns true for valid hit", () => {
    const hit: InspireLiteratureHit = {
      id: "123",
      created: "2024-01-01",
      updated: "2024-01-02",
      metadata: {
        control_number: 123456,
        titles: [{ title: "Test Paper" }],
      },
    };
    expect(isInspireLiteratureHit(hit)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isInspireLiteratureHit(null)).toBe(false);
  });

  it("returns false for missing id", () => {
    expect(
      isInspireLiteratureHit({
        metadata: { control_number: 123, titles: [] },
      })
    ).toBe(false);
  });

  it("returns false for missing metadata", () => {
    expect(isInspireLiteratureHit({ id: "123" })).toBe(false);
  });

  it("returns false for missing control_number", () => {
    expect(
      isInspireLiteratureHit({ id: "123", metadata: { titles: [] } })
    ).toBe(false);
  });
});

describe("isCrossRefWorksResponse", () => {
  it("returns true for valid response", () => {
    const response: CrossRefWorksResponse = {
      status: "ok",
      "message-type": "work",
      "message-version": "1.0.0",
      message: {
        DOI: "10.1234/test",
      },
    };
    expect(isCrossRefWorksResponse(response)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isCrossRefWorksResponse(null)).toBe(false);
  });

  it("returns false for missing status", () => {
    expect(
      isCrossRefWorksResponse({ message: { DOI: "10.1234/test" } })
    ).toBe(false);
  });

  it("returns false for missing message", () => {
    expect(isCrossRefWorksResponse({ status: "ok" })).toBe(false);
  });

  it("returns false for missing DOI in message", () => {
    expect(
      isCrossRefWorksResponse({ status: "ok", message: {} })
    ).toBe(false);
  });
});

describe("extractRecidFromRef", () => {
  it("extracts recid from valid ref", () => {
    const ref: InspireRecordRef = {
      $ref: "https://inspirehep.net/api/literature/123456",
    };
    expect(extractRecidFromRef(ref)).toBe("123456");
  });

  it("extracts recid from long number", () => {
    const ref: InspireRecordRef = {
      $ref: "https://inspirehep.net/api/literature/1234567890",
    };
    expect(extractRecidFromRef(ref)).toBe("1234567890");
  });

  it("returns undefined for undefined ref", () => {
    expect(extractRecidFromRef(undefined)).toBeUndefined();
  });

  it("returns undefined for null $ref", () => {
    expect(extractRecidFromRef({ $ref: null as unknown as string })).toBeUndefined();
  });

  it("returns undefined for invalid URL format", () => {
    expect(
      extractRecidFromRef({ $ref: "https://example.com/other/123" })
    ).toBeUndefined();
  });

  it("returns undefined for non-numeric id", () => {
    expect(
      extractRecidFromRef({ $ref: "https://inspirehep.net/api/literature/abc" })
    ).toBeUndefined();
  });
});

describe("getPrimaryTitle", () => {
  it("returns first title when no source preference", () => {
    const titles: InspireTitle[] = [{ title: "First Title" }];
    expect(getPrimaryTitle(titles)).toBe("First Title");
  });

  it("prefers non-arXiv source title", () => {
    const titles: InspireTitle[] = [
      { title: "arXiv Title", source: "arXiv" },
      { title: "Journal Title", source: "publisher" },
    ];
    expect(getPrimaryTitle(titles)).toBe("Journal Title");
  });

  it("falls back to arXiv title if only option", () => {
    const titles: InspireTitle[] = [{ title: "arXiv Title", source: "arXiv" }];
    expect(getPrimaryTitle(titles)).toBe("arXiv Title");
  });

  it("returns undefined for empty array", () => {
    expect(getPrimaryTitle([])).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(getPrimaryTitle(undefined)).toBeUndefined();
  });
});

describe("getPrimaryArxivId", () => {
  it("returns first arXiv ID", () => {
    const eprints: InspireArxivEprint[] = [
      { value: "2301.12345", categories: ["hep-th"] },
    ];
    expect(getPrimaryArxivId(eprints)).toBe("2301.12345");
  });

  it("returns undefined for empty array", () => {
    expect(getPrimaryArxivId([])).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(getPrimaryArxivId(undefined)).toBeUndefined();
  });
});

describe("getPrimaryDoi", () => {
  it("returns first DOI", () => {
    const dois: InspireDOI[] = [{ value: "10.1103/PhysRevD.100.014001" }];
    expect(getPrimaryDoi(dois)).toBe("10.1103/PhysRevD.100.014001");
  });

  it("returns undefined for empty array", () => {
    expect(getPrimaryDoi([])).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(getPrimaryDoi(undefined)).toBeUndefined();
  });
});

describe("getPrimaryAbstract", () => {
  it("returns first abstract", () => {
    const abstracts: InspireAbstract[] = [
      { value: "This is the abstract text.", source: "arXiv" },
    ];
    expect(getPrimaryAbstract(abstracts)).toBe("This is the abstract text.");
  });

  it("returns undefined for empty array", () => {
    expect(getPrimaryAbstract([])).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(getPrimaryAbstract(undefined)).toBeUndefined();
  });
});
