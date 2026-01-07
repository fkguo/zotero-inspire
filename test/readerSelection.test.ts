import { describe, expect, it } from "vitest";
import {
  formatReaderSelectionEvidence,
  type ReaderSelectionPayload,
} from "../src/modules/inspire/readerSelection";
import {
  computeRectsBoundingBox,
  splitSelectionRectsByPage,
} from "../src/modules/inspire/readerSelectionImage";
import { parseDataUrl, stripDataUrlPrefix } from "../src/modules/inspire/llm/media";
import { profileSupportsImageInput } from "../src/modules/inspire/llm/capabilities";
import type { AIProfile } from "../src/modules/inspire/llm/profileStore";

describe("readerSelection", () => {
  it("formats [SEL] evidence with IDs and page", () => {
    const sel: ReaderSelectionPayload = {
      source: "zotero_reader_selection",
      parentItemID: 10,
      parentItemKey: "ABCD1234",
      attachmentItemID: 20,
      attachmentItemKey: "EFGH5678",
      readerTabID: "tab1",
      pageIndex: 0,
      pageLabel: "iii",
      text: "Hello world",
      position: {
        pageIndex: 0,
        rects: [
          [1, 2, 3, 4],
          [10, 20, 30, 40],
        ],
        nextPageRects: [[5, 6, 7, 8]],
      },
      createdAt: Date.now(),
    };

    const out = formatReaderSelectionEvidence(sel, { maxChars: 1000 });
    expect(out.startsWith("[SEL]")).toBe(true);
    expect(out).toContain("Parent: ABCD1234");
    expect(out).toContain("Attachment: EFGH5678");
    expect(out).toContain("Page: iii");
    expect(out).toContain("Rects: 2 (+1 next page)");
    expect(out).toContain("Text:\nHello world");
  });

  it("truncates selection text when maxChars is exceeded", () => {
    const sel: ReaderSelectionPayload = {
      source: "zotero_reader_selection",
      parentItemID: 1,
      attachmentItemID: 2,
      text: "0123456789ABCDEFGHIJ",
      createdAt: Date.now(),
    };
    const out = formatReaderSelectionEvidence(sel, { maxChars: 10 });
    expect(out).toContain("0123456789…");
    expect(out).toContain("Selection truncated to 10 chars");
  });
});

describe("readerSelectionImage", () => {
  it("computes a bounding box for rects (order-invariant)", () => {
    const bbox = computeRectsBoundingBox([
      [30, 40, 10, 20],
      [5, 15, 25, 35],
    ]);
    expect(bbox).toEqual({ x1: 5, y1: 15, x2: 30, y2: 40 });
  });

  it("returns null for empty/invalid rects", () => {
    expect(computeRectsBoundingBox([])).toBe(null);
    expect(computeRectsBoundingBox(undefined)).toBe(null);
    expect(computeRectsBoundingBox([[0, 0, 0, 0]])).toBe(null);
  });

  it("splits rects across pages when nextPageRects is present", () => {
    const pages = splitSelectionRectsByPage({
      pageIndex: 2,
      rects: [[1, 1, 2, 2]],
      nextPageRects: [[3, 3, 4, 4]],
    });
    expect(pages).toEqual([
      { pageIndex: 2, rects: [[1, 1, 2, 2]] },
      { pageIndex: 3, rects: [[3, 3, 4, 4]] },
    ]);
  });
});

describe("llm/media", () => {
  it("parses data URLs and strips prefixes", () => {
    expect(parseDataUrl("data:image/png;base64,AA==")).toEqual({
      mimeType: "image/png",
      data: "AA==",
    });
    expect(stripDataUrlPrefix("data:image/png;base64,AA==")).toBe("AA==");
    expect(stripDataUrlPrefix("  AA==  ")).toBe("AA==");
  });
});

describe("llm/capabilities", () => {
  it("enables images for Gemini profiles", () => {
    const p: AIProfile = {
      id: "g1",
      name: "Gemini",
      provider: "gemini",
      model: "gemini-1.5-flash",
      createdAt: Date.now(),
    };
    expect(profileSupportsImageInput(p)).toBe(true);
  });

  it("enables images for Claude 3+ and rejects Claude 2.x", () => {
    const c3: AIProfile = {
      id: "c3",
      name: "Claude",
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      createdAt: Date.now(),
    };
    const c2: AIProfile = {
      id: "c2",
      name: "Claude 2",
      provider: "anthropic",
      model: "claude-2.1",
      createdAt: Date.now(),
    };
    expect(profileSupportsImageInput(c3)).toBe(true);
    expect(profileSupportsImageInput(c2)).toBe(false);
  });

  it("rejects DeepSeek openaiCompatible and accepts vision-like models", () => {
    const deepseek: AIProfile = {
      id: "ds",
      name: "DeepSeek",
      provider: "openaiCompatible",
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      preset: "deepseek",
      createdAt: Date.now(),
    };
    const gpt4o: AIProfile = {
      id: "oai",
      name: "OpenAI",
      provider: "openaiCompatible",
      baseURL: "https://api.example.com/v1",
      model: "gpt-4o-mini",
      createdAt: Date.now(),
    };
    const qwenVl: AIProfile = {
      id: "qwen",
      name: "Qwen VL",
      provider: "openaiCompatible",
      baseURL: "https://api.example.com/v1",
      model: "Qwen/Qwen2.5-VL-72B-Instruct",
      createdAt: Date.now(),
    };
    expect(profileSupportsImageInput(deepseek)).toBe(false);
    expect(profileSupportsImageInput(gpt4o)).toBe(true);
    expect(profileSupportsImageInput(qwenVl)).toBe(true);
  });
});

