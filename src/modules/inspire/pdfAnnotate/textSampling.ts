// ─────────────────────────────────────────────────────────────────────────────
// PDF Text Sampling Utilities
// Used to avoid heavy full-text parsing on large PDFs.
// ─────────────────────────────────────────────────────────────────────────────

export type PdfTextCandidateKind = "tailPages" | "tailChars" | "full";

export interface PdfTextSampleCandidate {
  kind: PdfTextCandidateKind;
  /** Tail pages (when kind=tailPages) or tail chars (when kind=tailChars). */
  value: number;
  /** The sliced text to parse. */
  text: string;
  /** Start index in the original text (0 means full). */
  startIndex: number;
}

function collectFormFeedOffsetsFromEnd(text: string, maxCount: number): number[] {
  const offsets: number[] = [];
  // Form feed is U+000C
  for (let i = text.length - 1; i >= 0 && offsets.length < maxCount; i--) {
    if (text.charCodeAt(i) === 12) {
      offsets.push(i);
    }
  }
  return offsets;
}

function getTailStartIndexByPages(
  formFeedOffsetsFromEnd: number[],
  tailPages: number,
): number {
  if (tailPages <= 0) return 0;
  const ffIndex = formFeedOffsetsFromEnd[tailPages - 1];
  return typeof ffIndex === "number" ? ffIndex + 1 : 0;
}

function getTailStartIndexByChars(textLength: number, tailChars: number): number {
  if (tailChars <= 0) return 0;
  return Math.max(0, textLength - tailChars);
}

/**
 * Build progressively larger text candidates for reference-list parsing.
 *
 * Strategy:
 * - Prefer form-feed (`\f`) page boundaries when available (fast tail-page slicing).
 * - Fallback to tail-character slicing when `\f` is absent.
 * - Always include a final `full` candidate to avoid regressions.
 */
export function buildPdfTextCandidatesForReferenceParsing(
  fullText: string,
  options?: {
    pageSteps?: number[];
    maxTailPages?: number;
    charSteps?: number[];
    maxTailChars?: number;
  },
): PdfTextSampleCandidate[] {
  const text = fullText ?? "";
  const maxTailPages = options?.maxTailPages ?? 120;
  const maxTailChars = options?.maxTailChars ?? 3_000_000;

  const pageSteps =
    options?.pageSteps?.length
      ? options.pageSteps
      : [8, 16, 32, 64, 96, 120];

  const charSteps =
    options?.charSteps?.length
      ? options.charSteps
      : [200_000, 400_000, 800_000, 1_600_000, 2_400_000, 3_000_000];

  const candidates: PdfTextSampleCandidate[] = [];
  const seenStart = new Set<number>();

  const hasFormFeed = text.indexOf("\f") >= 0;
  if (hasFormFeed) {
    const ffOffsetsFromEnd = collectFormFeedOffsetsFromEnd(text, maxTailPages);
    for (const step of pageSteps) {
      const pages = Math.min(step, maxTailPages);
      const startIndex = getTailStartIndexByPages(ffOffsetsFromEnd, pages);
      if (seenStart.has(startIndex)) continue;
      seenStart.add(startIndex);
      candidates.push({
        kind: "tailPages",
        value: pages,
        startIndex,
        text: text.slice(startIndex),
      });
      // Once we've reached the full text, further steps are redundant.
      if (startIndex === 0) break;
    }
  } else {
    for (const step of charSteps) {
      const chars = Math.min(step, maxTailChars);
      const startIndex = getTailStartIndexByChars(text.length, chars);
      if (seenStart.has(startIndex)) continue;
      seenStart.add(startIndex);
      candidates.push({
        kind: "tailChars",
        value: chars,
        startIndex,
        text: text.slice(startIndex),
      });
      if (startIndex === 0) break;
    }
  }

  // Ensure full-text candidate exists as last resort (no regression).
  if (!seenStart.has(0)) {
    candidates.push({ kind: "full", value: text.length, startIndex: 0, text });
  } else {
    // If the last candidate already covers the full text, normalize kind to "full".
    const last = candidates[candidates.length - 1];
    if (last && last.startIndex === 0 && last.kind !== "full") {
      candidates[candidates.length - 1] = {
        kind: "full",
        value: text.length,
        startIndex: 0,
        text,
      };
    }
  }

  return candidates;
}

