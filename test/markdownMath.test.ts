import { describe, expect, it } from "vitest";
import { markdownToSafeHtml } from "../src/modules/inspire/llm/markdown";

describe("markdown math support", () => {
  it("wraps single-line display math as a KaTeX-friendly block", () => {
    const html = markdownToSafeHtml("$$ R = 1 $$");
    expect(html).toContain("zinspire-math-block");
    expect(html).toContain("R = 1");
    expect(html).not.toContain("zinspire-math-inline");
  });

  it("supports compact single-line display math", () => {
    const html = markdownToSafeHtml("$$R=1$$");
    expect(html).toContain("zinspire-math-block");
    expect(html).toContain("R=1");
  });

  it("wraps block math when $$ are on their own lines", () => {
    const html = markdownToSafeHtml("$$\nR = 1\n$$\n");
    expect(html).toContain("zinspire-math-block");
    expect(html).toContain("$$");
    expect(html).toContain("R = 1");
  });

  it("wraps inline math in a KaTeX-friendly span", () => {
    const html = markdownToSafeHtml("Energy: $E = mc^2$.");
    expect(html).toContain("zinspire-math-inline");
    expect(html).toContain("$E = mc^2$");
  });
});
