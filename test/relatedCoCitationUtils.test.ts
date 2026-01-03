import { describe, it, expect } from "vitest";
import {
  computeCoCitationBlendWeight,
  computeNormalizedCoCitation,
} from "../src/modules/inspire/relatedCoCitationUtils";

describe("relatedCoCitationUtils", () => {
  describe("computeCoCitationBlendWeight", () => {
    it("returns 0 for invalid/low citation counts", () => {
      expect(computeCoCitationBlendWeight(undefined)).toBe(0);
      expect(computeCoCitationBlendWeight(NaN)).toBe(0);
      expect(computeCoCitationBlendWeight(-1)).toBe(0);
      expect(computeCoCitationBlendWeight(0)).toBe(0);
      expect(computeCoCitationBlendWeight(4)).toBe(0);
    });

    it("caps at 0.5 and increases with citations", () => {
      const w10 = computeCoCitationBlendWeight(10);
      const w30 = computeCoCitationBlendWeight(30);
      const w50 = computeCoCitationBlendWeight(50);
      const w500 = computeCoCitationBlendWeight(500);

      expect(w10).toBeGreaterThanOrEqual(0);
      expect(w30).toBeGreaterThan(w10);
      expect(w50).toBeGreaterThan(w30);
      expect(w50).toBeLessThanOrEqual(0.5);
      expect(w500).toBeLessThanOrEqual(0.5);
      // With default constants, 50 citations should be close to the 0.5 cap.
      expect(w50).toBeGreaterThan(0.45);
    });
  });

  describe("computeNormalizedCoCitation", () => {
    it("returns 0 for invalid inputs", () => {
      expect(computeNormalizedCoCitation(undefined, 10, 10)).toBe(0);
      expect(computeNormalizedCoCitation(1, undefined, 10)).toBe(0);
      expect(computeNormalizedCoCitation(1, 10, undefined)).toBe(0);
      expect(computeNormalizedCoCitation(0, 10, 10)).toBe(0);
      expect(computeNormalizedCoCitation(1, 0, 10)).toBe(0);
      expect(computeNormalizedCoCitation(1, 10, 0)).toBe(0);
    });

    it("computes cosine-like similarity and clamps to [0,1]", () => {
      const sim = computeNormalizedCoCitation(10, 100, 25);
      expect(sim).toBeCloseTo(0.2, 6);

      // If co-cited count exceeds sqrt(product), clamp to 1.
      const simHigh = computeNormalizedCoCitation(1000, 10, 10);
      expect(simHigh).toBe(1);
    });
  });
});

