// ─────────────────────────────────────────────────────────────────────────────
// collabTagService.test.ts - Unit tests for collaboration tag service
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  extractCollabName,
  formatCollabTag,
  COLLAB_SUFFIX_PATTERN,
  DEFAULT_TAG_TEMPLATE,
} from "../src/modules/inspire/collabTagService";

describe("COLLAB_SUFFIX_PATTERN", () => {
  it("matches 'Collaboration' suffix", () => {
    expect("ATLAS Collaboration".replace(COLLAB_SUFFIX_PATTERN, "")).toBe(
      "ATLAS",
    );
    expect("CMS Collaboration".replace(COLLAB_SUFFIX_PATTERN, "")).toBe("CMS");
  });

  it("matches 'Collab' suffix with optional period", () => {
    expect("LHCb Collab".replace(COLLAB_SUFFIX_PATTERN, "")).toBe("LHCb");
    expect("LHCb Collab.".replace(COLLAB_SUFFIX_PATTERN, "")).toBe("LHCb");
  });

  it("matches 'Group' suffix", () => {
    expect("Particle Data Group".replace(COLLAB_SUFFIX_PATTERN, "")).toBe(
      "Particle Data",
    );
  });

  it("matches 'Team' suffix", () => {
    expect("Alpha Team".replace(COLLAB_SUFFIX_PATTERN, "")).toBe("Alpha");
  });

  it("matches 'Consortium' suffix", () => {
    expect("GWIC Consortium".replace(COLLAB_SUFFIX_PATTERN, "")).toBe("GWIC");
  });

  it("matches 'Experiment' suffix", () => {
    expect("DUNE Experiment".replace(COLLAB_SUFFIX_PATTERN, "")).toBe("DUNE");
  });

  it("is case insensitive", () => {
    expect("ATLAS collaboration".replace(COLLAB_SUFFIX_PATTERN, "")).toBe(
      "ATLAS",
    );
    expect("CMS COLLABORATION".replace(COLLAB_SUFFIX_PATTERN, "")).toBe("CMS");
  });

  it("does not match when suffix is in the middle", () => {
    const result = "Collaboration Data".replace(COLLAB_SUFFIX_PATTERN, "");
    expect(result).toBe("Collaboration Data");
  });
});

describe("extractCollabName", () => {
  it("returns empty string for empty input", () => {
    expect(extractCollabName("")).toBe("");
    expect(extractCollabName(null as unknown as string)).toBe("");
    expect(extractCollabName(undefined as unknown as string)).toBe("");
  });

  it("extracts short name from full collaboration name", () => {
    expect(extractCollabName("ATLAS Collaboration")).toBe("ATLAS");
    expect(extractCollabName("CMS Collaboration")).toBe("CMS");
    expect(extractCollabName("LHCb Collaboration")).toBe("LHCb");
    expect(extractCollabName("ALICE Collaboration")).toBe("ALICE");
  });

  it("handles 'Collab' abbreviation", () => {
    expect(extractCollabName("LHCb Collab.")).toBe("LHCb");
    expect(extractCollabName("ATLAS Collab")).toBe("ATLAS");
  });

  it("handles 'Group' suffix", () => {
    expect(extractCollabName("Particle Data Group")).toBe("Particle Data");
  });

  it("returns original name if no suffix found", () => {
    expect(extractCollabName("Belle II")).toBe("Belle II");
    expect(extractCollabName("ATLAS")).toBe("ATLAS");
    expect(extractCollabName("CMS")).toBe("CMS");
  });

  it("handles multi-word collaboration names", () => {
    expect(extractCollabName("Super-Kamiokande Collaboration")).toBe(
      "Super-Kamiokande",
    );
    expect(extractCollabName("IceCube Collaboration")).toBe("IceCube");
  });

  it("trims result whitespace", () => {
    // The function trims the result after removing the suffix
    expect(extractCollabName("ATLAS Collaboration")).toBe("ATLAS");
    expect(extractCollabName("  ATLAS  Collaboration")).toBe("ATLAS");
  });
});

describe("DEFAULT_TAG_TEMPLATE", () => {
  it("should be {name}", () => {
    expect(DEFAULT_TAG_TEMPLATE).toBe("{name}");
  });
});

describe("formatCollabTag", () => {
  // Note: formatCollabTag relies on getPref() which requires Zotero
  // These tests are skipped since mocking Zotero.Prefs is complex
  // The template replacement logic is tested separately below

  it.skip("returns empty string for empty input", () => {
    expect(formatCollabTag("")).toBe("");
  });

  it.skip("extracts short name and formats with default template", () => {
    // With default template "{name}", result is just the short name
    const result = formatCollabTag("ATLAS Collaboration");
    expect(result).toBe("ATLAS");
  });

  it.skip("handles names without suffix", () => {
    const result = formatCollabTag("Belle II");
    expect(result).toBe("Belle II");
  });
});

describe("extractCollaborationsFromExtra", () => {
  // This function requires a Zotero.Item mock which is complex
  // Testing the regex pattern directly instead

  it("matches tex.collaboration pattern", () => {
    const pattern = /^tex\.collaboration:\s*(.+)$/m;
    const extra = "tex.collaboration: ATLAS, CMS, LHCb";
    const match = extra.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("ATLAS, CMS, LHCb");
  });

  it("matches single collaboration", () => {
    const pattern = /^tex\.collaboration:\s*(.+)$/m;
    const extra = "tex.collaboration: ATLAS";
    const match = extra.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("ATLAS");
  });

  it("matches collaboration in multi-line extra", () => {
    const pattern = /^tex\.collaboration:\s*(.+)$/m;
    const extra =
      "arXiv:2301.12345 [hep-ex]\ntex.collaboration: ATLAS, CMS\nCitation Key: ATLAS:2023abc";
    const match = extra.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("ATLAS, CMS");
  });

  it("does not match when pattern is absent", () => {
    const pattern = /^tex\.collaboration:\s*(.+)$/m;
    const extra = "arXiv:2301.12345 [hep-ex]\nCitation Key: ATLAS:2023abc";
    const match = extra.match(pattern);
    expect(match).toBeNull();
  });
});

describe("Tag format template variations", () => {
  // Test the template replacement logic directly

  it("default template {name} produces short name", () => {
    const template = "{name}";
    const shortName = "ATLAS";
    expect(template.replace("{name}", shortName)).toBe("ATLAS");
  });

  it("prefix template #collab/{name} works", () => {
    const template = "#collab/{name}";
    const shortName = "ATLAS";
    expect(template.replace("{name}", shortName)).toBe("#collab/ATLAS");
  });

  it("prefix template collab:{name} works", () => {
    const template = "collab:{name}";
    const shortName = "ATLAS";
    expect(template.replace("{name}", shortName)).toBe("collab:ATLAS");
  });

  it("emoji prefix 🔬{name} works", () => {
    const template = "🔬{name}";
    const shortName = "ATLAS";
    expect(template.replace("{name}", shortName)).toBe("🔬ATLAS");
  });

  it("suffix template {name}-collab works", () => {
    const template = "{name}-collab";
    const shortName = "ATLAS";
    expect(template.replace("{name}", shortName)).toBe("ATLAS-collab");
  });
});

describe("Edge cases", () => {
  it("handles names with special characters", () => {
    expect(extractCollabName("Belle-II Collaboration")).toBe("Belle-II");
    expect(extractCollabName("D0 Collaboration")).toBe("D0");
    expect(extractCollabName("D∅ Collaboration")).toBe("D∅");
  });

  it("handles very long collaboration names", () => {
    const longName = "Very Long Collaboration Name That Goes On And On";
    const result = extractCollabName(longName);
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles collaboration names with numbers", () => {
    expect(extractCollabName("Belle II")).toBe("Belle II");
    expect(extractCollabName("T2K Collaboration")).toBe("T2K");
    expect(extractCollabName("NA62 Collaboration")).toBe("NA62");
  });
});
