import {
  normalizeArxivId,
  normalizeDoi,
  normalizeJournal,
} from "./matchScoring";
import {
  NATIVE_OVERLAY_LIMITS,
  type NativeOverlayToken,
} from "./nativeOverlayTypes";
import type { NativeOverlayBuildState } from "./nativeOverlayBuilder";

export type NativeTokenizationResult =
  | { kind: "progress" }
  | { kind: "terminal"; code: string };

export function runNativeTokenizationSlice(
  state: NativeOverlayBuildState,
  now: () => number,
  deadline: number,
): NativeTokenizationResult {
  let structural = NATIVE_OVERLAY_LIMITS.sliceStructuralUnits;
  let textBudget = NATIVE_OVERLAY_LIMITS.sliceTextUnits;
  while (
    state.tokenizeLabelCursor < state.labelOrder.length &&
    structural > 0 &&
    textBudget > 0 &&
    now() < deadline
  ) {
    const label = state.labelOrder[state.tokenizeLabelCursor];
    const texts = state.rawByLabel.get(label)!;
    if (state.tokenizeTextCursor >= texts.length) {
      // A label with no associated raw pair retains one temporary empty-label
      // marker after Phase A. Drop it when Phase B visits that label.
      if (texts.length === 0) {
        state.liveRecords = Math.max(0, state.liveRecords - 1);
      }
      texts.length = 0;
      state.tokenizeLabelCursor++;
      state.tokenizeTextCursor = 0;
      resetTextScanner(state);
      continue;
    }
    const text = texts[state.tokenizeTextCursor];
    const step = scanOneStep(text, state);
    if (step.tokens.length) {
      state.tokenMap.get(label)!.push(...step.tokens);
      state.tokenizeCurrentRetainsOrigin = true;
    }
    if (state.phase === "terminal") {
      return { kind: "terminal", code: state.terminalCode || "tokenization" };
    }
    structural -=
      1 +
      step.tokens.reduce((sum, token) => sum + tokenFields(token).records, 0);
    textBudget -= step.textWork;
    if (step.complete) {
      texts[state.tokenizeTextCursor] = "";
      if (state.tokenizeCurrentRetainsOrigin) {
        state.dependentOriginTextUnits += text.length;
      } else {
        state.retainedTextUnits = Math.max(
          0,
          state.retainedTextUnits - text.length,
        );
      }
      state.liveRecords = Math.max(0, state.liveRecords - 2);
      state.tokenizeTextCursor++;
      resetTextScanner(state);
    }
  }
  if (state.tokenizeLabelCursor >= state.labelOrder.length) {
    state.rawByLabel.clear();
    state.phase = "publish-signature";
  }
  return { kind: "progress" };
}

function scanOneStep(
  text: string,
  state: NativeOverlayBuildState,
): { tokens: NativeOverlayToken[]; textWork: number; complete: boolean } {
  if (!chargeScannerStep(state))
    return { tokens: [], textWork: 0, complete: false };
  if (state.tokenizeFallbackPending) {
    const finalized = finalizeSegment(text, state);
    return { ...finalized, complete: true };
  }

  const startCursor = state.tokenizeScanCursor;
  const limit = Math.min(text.length, startCursor + 512);
  if (state.tokenizeSkippingWhitespace) {
    let cursor = startCursor;
    while (cursor < limit && /\s/.test(text[cursor])) cursor++;
    state.tokenizeScanCursor = cursor;
    state.tokenizeSegmentStart = cursor;
    if (cursor < text.length && !/\s/.test(text[cursor])) {
      state.tokenizeSkippingWhitespace = false;
    }
    if (cursor === text.length) {
      return finishScannedText(text, state, cursor - startCursor);
    }
    return { tokens: [], textWork: cursor - startCursor, complete: false };
  }

  let delimiter = -1;
  for (let cursor = startCursor; cursor < limit; cursor++) {
    if (text[cursor] === ";") {
      delimiter = cursor;
      break;
    }
  }
  if (delimiter >= 0) {
    const segment = text.slice(state.tokenizeSegmentStart, delimiter);
    state.tokenizeScanCursor = delimiter + 1;
    state.tokenizeSegmentStart = delimiter + 1;
    state.tokenizeSkippingWhitespace = true;
    const finalized = useful(segment)
      ? finalizeUsefulSegment(segment, state)
      : { tokens: [], textWork: 0 };
    return {
      ...finalized,
      textWork: finalized.textWork + delimiter + 1 - startCursor,
      complete: false,
    };
  }

  state.tokenizeScanCursor = limit;
  if (limit < text.length) {
    return { tokens: [], textWork: limit - startCursor, complete: false };
  }
  const finalSegment = text.slice(state.tokenizeSegmentStart);
  const finalized = useful(finalSegment)
    ? finalizeUsefulSegment(finalSegment, state)
    : { tokens: [], textWork: 0 };
  if (!state.tokenizeHadUseful) {
    state.tokenizeFallbackPending = true;
    return {
      ...finalized,
      textWork: finalized.textWork + limit - startCursor,
      complete: false,
    };
  }
  return {
    ...finalized,
    textWork: finalized.textWork + limit - startCursor,
    complete: true,
  };
}

function finishScannedText(
  text: string,
  state: NativeOverlayBuildState,
  textWork: number,
): { tokens: NativeOverlayToken[]; textWork: number; complete: boolean } {
  if (state.tokenizeHadUseful) return { tokens: [], textWork, complete: true };
  state.tokenizeFallbackPending = true;
  return { tokens: [], textWork, complete: false };
}

function useful(segment: string): boolean {
  return segment.trim().length > 10;
}

function finalizeUsefulSegment(
  segment: string,
  state: NativeOverlayBuildState,
): { tokens: NativeOverlayToken[]; textWork: number } {
  state.tokenizeHadUseful = true;
  return finalizeSegment(segment, state);
}

function finalizeSegment(
  segment: string,
  state: NativeOverlayBuildState,
): { tokens: NativeOverlayToken[]; textWork: number } {
  if (
    /\(E\)/.test(segment) ||
    /\berratum\b/i.test(segment) ||
    /^\s*[A-Z]?\d+\s*,/.test(segment)
  )
    return { tokens: [], textWork: 0 };

  const token: NativeOverlayToken = {};
  const arxiv = segment.match(/arXiv[:\s]*([\d.]+|[a-z-]+\/\d+)/i);
  const normalizedArxiv = arxiv ? normalizeArxivId(arxiv[1]) : null;
  if (
    normalizedArxiv &&
    normalizedArxiv.length <= NATIVE_OVERLAY_LIMITS.maxIdentifierUnits
  )
    token.arxiv = copyString(normalizedArxiv);

  const doi = segment.match(/\b(10\.\d{4,}\/[^\s,;]+)/);
  const normalizedDoi = doi ? normalizeDoi(doi[1]) : null;
  if (
    normalizedDoi &&
    normalizedDoi.length <= NATIVE_OVERLAY_LIMITS.maxIdentifierUnits
  )
    token.doi = copyString(normalizedDoi);

  const exact = segment.match(
    /(?:Phys\.?\s*Rev\.?|Nucl\.?\s*Phys\.?|JHEP|JCAP|Eur\.?\s*Phys\.?\s*J\.?|Class\.?\s*Quantum\s*Grav\.?|Phys\.?\s*Lett\.?)[^\d]*(\d+)[^\d]*(\d+[A-Za-z]?\d*)/i,
  );
  if (exact) {
    const journal = normalizeJournal(exact[0].split(/\d/)[0].trim());
    if (
      journal &&
      journal.length <= NATIVE_OVERLAY_LIMITS.maxJournalUnits &&
      exact[1].length <= NATIVE_OVERLAY_LIMITS.maxVolumePageUnits &&
      exact[2].length <= NATIVE_OVERLAY_LIMITS.maxVolumePageUnits
    ) {
      token.exactJournalKey = copyString(`${journal}:${exact[1]}:${exact[2]}`);
    }
  }

  const generic = segment.match(
    /([A-Za-z][A-Za-z.\s()]+?)\s+(\d+)\s*[,:(\s]\s*(\d+[A-Za-z]?\d*)/,
  );
  if (generic) {
    const journal = generic[1].trim();
    if (
      journal.length <= NATIVE_OVERLAY_LIMITS.maxJournalUnits &&
      generic[2].length <= NATIVE_OVERLAY_LIMITS.maxVolumePageUnits &&
      generic[3].length <= NATIVE_OVERLAY_LIMITS.maxVolumePageUnits
    ) {
      token.genericJournal = {
        journal: copyString(journal),
        volume: copyString(generic[2]),
        page: copyString(generic[3]),
      };
    }
  }

  const fields = tokenFields(token);
  if (!fields.records) return { tokens: [], textWork: 0 };
  if (
    state.durableRecords + fields.records >
      NATIVE_OVERLAY_LIMITS.maxDurableWorkRecords ||
    state.liveRecords + fields.records > NATIVE_OVERLAY_LIMITS.maxLiveRecords
  ) {
    fail(
      state,
      state.durableRecords + fields.records >
        NATIVE_OVERLAY_LIMITS.maxDurableWorkRecords
        ? "durable-record-cap"
        : "live-record-cap",
    );
    return { tokens: [], textWork: 0 };
  }
  if (
    state.retainedTextUnits + fields.textUnits >
    NATIVE_OVERLAY_LIMITS.maxRetainedTextUnits
  ) {
    fail(state, "retained-text-cap");
    return { tokens: [], textWork: 0 };
  }
  state.durableRecords += fields.records;
  state.liveRecords += fields.records;
  state.retainedTextUnits += fields.textUnits;
  return { tokens: [token], textWork: fields.textUnits };
}

function tokenFields(token: NativeOverlayToken): {
  records: number;
  textUnits: number;
} {
  let records = 1;
  let textUnits = 0;
  for (const value of [token.arxiv, token.doi, token.exactJournalKey]) {
    if (value) {
      records++;
      textUnits += value.length;
    }
  }
  if (token.genericJournal) {
    records += 3;
    textUnits +=
      token.genericJournal.journal.length +
      token.genericJournal.volume.length +
      token.genericJournal.page.length;
  }
  return records === 1 ? { records: 0, textUnits: 0 } : { records, textUnits };
}

function chargeScannerStep(state: NativeOverlayBuildState): boolean {
  state.scannerSteps++;
  if (state.scannerSteps <= NATIVE_OVERLAY_LIMITS.maxScannerSteps) return true;
  fail(state, "scanner-step-cap");
  return false;
}

function resetTextScanner(state: NativeOverlayBuildState): void {
  state.tokenizeScanCursor = 0;
  state.tokenizeSegmentStart = 0;
  state.tokenizeHadUseful = false;
  state.tokenizeSkippingWhitespace = false;
  state.tokenizeFallbackPending = false;
  state.tokenizeCurrentRetainsOrigin = false;
}

function copyString(value: string): string {
  return Array.from(value).join("");
}

function fail(state: NativeOverlayBuildState, code: string): void {
  state.phase = "terminal";
  state.terminalCode = code;
}
