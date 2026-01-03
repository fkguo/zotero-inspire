import {
  RELATED_COCITATION_MAX_WEIGHT,
  RELATED_COCITATION_MIN_CITATIONS,
  RELATED_COCITATION_SIGMOID_CENTER_CITATIONS,
  RELATED_COCITATION_SIGMOID_SLOPE,
} from "./constants";

function sigmoid(x: number): number {
  // Numerically stable enough for our small input range.
  return 1 / (1 + Math.exp(-x));
}

export function computeCoCitationBlendWeight(
  seedCitationCount: number | undefined,
): number {
  if (
    typeof seedCitationCount !== "number" ||
    !Number.isFinite(seedCitationCount) ||
    seedCitationCount < RELATED_COCITATION_MIN_CITATIONS
  ) {
    return 0;
  }

  const x =
    RELATED_COCITATION_SIGMOID_SLOPE *
    (seedCitationCount - RELATED_COCITATION_SIGMOID_CENTER_CITATIONS);

  const w = RELATED_COCITATION_MAX_WEIGHT * sigmoid(x);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return Math.min(RELATED_COCITATION_MAX_WEIGHT, Math.max(0, w));
}

export function computeNormalizedCoCitation(
  coCitedCount: number | undefined,
  seedCitationCount: number | undefined,
  candidateCitationCount: number | undefined,
): number {
  if (
    typeof coCitedCount !== "number" ||
    !Number.isFinite(coCitedCount) ||
    coCitedCount <= 0
  ) {
    return 0;
  }
  if (
    typeof seedCitationCount !== "number" ||
    !Number.isFinite(seedCitationCount) ||
    seedCitationCount <= 0
  ) {
    return 0;
  }
  if (
    typeof candidateCitationCount !== "number" ||
    !Number.isFinite(candidateCitationCount) ||
    candidateCitationCount <= 0
  ) {
    return 0;
  }

  const denom = Math.sqrt(seedCitationCount * candidateCitationCount);
  if (!Number.isFinite(denom) || denom <= 0) {
    return 0;
  }

  const sim = coCitedCount / denom;
  if (!Number.isFinite(sim) || sim <= 0) return 0;
  // Co-citation cosine similarity is in [0, 1] for set vectors; clamp defensively.
  return Math.min(1, Math.max(0, sim));
}

