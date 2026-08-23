import type { NativeOverlayProfile } from "./nativeOverlayHostProfile";
import {
  isNativeObject,
  openNativeWaivedRoot,
  readNativeOwnData,
} from "./nativeOverlayBridge";
import {
  NATIVE_OVERLAY_LIMITS,
  type NativeLinkedReferenceCapture,
  type NativeLinkedReferenceEvidence,
  type NativeLinkedReferenceHandle,
} from "./nativeOverlayTypes";
import { makeNativeWeakRef, type WeakRefLike } from "./overlayCoordinatorUtils";

type Rect = readonly [number, number, number, number];

interface NativeLinkedHost {
  primaryView: object;
  pdfDocument: object;
  pdfPages: object;
  numPages: number;
}

interface LinkedCaptureRecord {
  handle: NativeLinkedReferenceHandle;
  label: string;
  sourceAttachmentItemID: number;
  destinationPageIndex?: number;
  destinationRects?: readonly Rect[];
  /** Exact text already extracted by Zotero's native citation matcher. */
  referenceText?: string;
  readerRef: WeakRefLike<object>;
  primaryViewRef: WeakRefLike<object>;
  pdfDocumentRef: WeakRefLike<object>;
}

interface LinkedCaptureBudget {
  referenceSlots: number;
  textUnits: number;
  exhausted: boolean;
}

type CitationReferenceCopy =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "text"; text: string };

interface PrimitiveChar {
  c: string;
  rect: Rect;
  ignorable: boolean;
  spaceAfter: boolean;
  lineBreakAfter: boolean;
  paragraphBreakAfter: boolean;
}

type HostRead =
  | { kind: "ready"; host: NativeLinkedHost }
  | { kind: "unavailable" };

/** The marker-local native result did not establish a usable reference. */
export function linkedReferenceIsInconclusive(
  evidence: NativeLinkedReferenceEvidence | undefined,
): boolean {
  return evidence?.kind === "unresolved" || evidence?.kind === "timeout";
}

/**
 * A per-marker link target remains strong when chapter numbering repeats.
 * Zotero's document-level citation overlay is still reusable for ordinary
 * unique-label lists, but must not suppress the established parser when the
 * cached INSPIRE list proves that a printed number is non-unique.
 */
export function shouldTrustLinkedReferenceForStrictMatch(
  evidence: NativeLinkedReferenceEvidence | undefined,
  hasDuplicateLabels: boolean,
): evidence is Extract<NativeLinkedReferenceEvidence, { kind: "resolved" }> {
  return (
    evidence?.kind === "resolved" &&
    (evidence.source === "link-target" || !hasDuplicateLabels)
  );
}

/**
 * Give a native target-page load a bounded opportunity without allowing a
 * stalled Zotero promise to block the established matcher indefinitely. The
 * source promise is intentionally left running so its single-flight result can
 * be reused by a later hover or click.
 */
export function settleLinkedReferenceWithin(
  promise: Promise<NativeLinkedReferenceEvidence>,
  budgetMs: number,
): Promise<NativeLinkedReferenceEvidence | undefined> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    // Keep a rejection handler attached even when the caller declines to wait.
    void promise.catch(() => undefined);
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, budgetMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/**
 * Bounded bridge for Zotero 10's per-page PDF internal-link path.
 *
 * Unlike the whole-document citation overlay, this intentionally accepts very
 * large PDFs. It reads the already-loaded source page synchronously and asks
 * Zotero to populate exactly one destination page only after a real hover or
 * click. Host objects remain behind opaque handles and never enter UI events.
 */
export class NativeLinkedReferenceResolver {
  private readonly records = new Map<
    NativeLinkedReferenceHandle,
    LinkedCaptureRecord
  >();
  private readonly pageLoads = new WeakMap<
    object,
    Map<number, Promise<void>>
  >();
  private nextHandle = 1;
  private stopped = false;

  constructor(
    private readonly profile: NativeOverlayProfile,
    private readonly runtimeEnabled: () => boolean,
  ) {}

  capture(
    outerReader: unknown,
    sourceAttachmentItemID: number,
    selectionPosition: unknown,
    label: string,
  ): NativeLinkedReferenceCapture | undefined {
    if (
      !this.enabled ||
      !isCanonicalNumericLabel(label) ||
      !Number.isSafeInteger(sourceAttachmentItemID) ||
      sourceAttachmentItemID <= 0 ||
      !isNativeObject(outerReader)
    ) {
      return undefined;
    }
    try {
      if (readOwnPrimitive(outerReader, "itemID") !== sourceAttachmentItemID) {
        return undefined;
      }
      const selection = copyPosition(selectionPosition);
      if (!selection) return undefined;
      const read = this.readHost(outerReader);
      if (read.kind !== "ready") return undefined;
      const { host } = read;
      if (selection.pageIndex >= host.numPages) return undefined;
      const page = readOwnObjectSlot(host.pdfPages, selection.pageIndex);
      if (!page) return undefined;
      const overlays = readOwnArray(page, "overlays");
      if (!overlays) return undefined;
      const overlayLength = readOwnArrayLength(overlays);
      if (overlayLength === undefined) return undefined;
      if (overlayLength > NATIVE_OVERLAY_LIMITS.maxLinkedSourceOverlays) {
        return { kind: "unresolved", label };
      }

      const destinations = new Map<
        string,
        { pageIndex: number; rects: readonly Rect[] }
      >();
      const citationTexts = new Set<string>();
      let citationTextAmbiguous = false;
      let invalidInternalTarget = false;
      const citationBudget: LinkedCaptureBudget = {
        referenceSlots: 0,
        textUnits: 0,
        exhausted: false,
      };
      for (let overlayIndex = 0; overlayIndex < overlayLength; overlayIndex++) {
        const overlay = readOwnPrimitive(overlays, String(overlayIndex));
        if (!isNativeObject(overlay)) continue;
        const overlayType = readOwnPrimitive(overlay, "type");
        if (overlayType !== "citation" && overlayType !== "internal-link") {
          continue;
        }
        const source = copyPosition(readOwnPrimitive(overlay, "position"));
        if (!source || source.pageIndex !== selection.pageIndex) continue;
        if (!rectSetsIntersect(source.rects, selection.rects)) continue;

        // Zotero's processed `citation` overlay already carries bibliography
        // records in `references[].text`. Keep that cheap result when it is the
        // only native evidence, but also capture an intersecting internal link:
        // its marker-local destination outranks the document-level numeric
        // lookup when chapter numbering repeats.
        if (overlayType === "citation") {
          const copied = copyCitationReferenceText(
            overlay,
            label,
            citationBudget,
          );
          if (citationBudget.exhausted) {
            return { kind: "unresolved", label };
          }
          if (copied.kind === "none") {
            continue;
          }
          if (copied.kind === "ambiguous") {
            citationTextAmbiguous = true;
            citationTexts.clear();
            continue;
          }
          if (citationTextAmbiguous) continue;
          citationTexts.add(copied.text);
          if (citationTexts.size > 1) {
            citationTextAmbiguous = true;
            citationTexts.clear();
          }
          continue;
        }

        const destination = copyPosition(
          readOwnPrimitive(overlay, "destinationPosition"),
        );
        if (
          !destination ||
          destination.pageIndex < 0 ||
          destination.pageIndex >= host.numPages
        ) {
          invalidInternalTarget = true;
          continue;
        }
        const key = `${destination.pageIndex}:${destination.rects
          .map((rect) => rect.join(","))
          .join(";")}`;
        destinations.set(key, destination);
      }
      const referenceText = citationTextAmbiguous
        ? undefined
        : (citationTexts.values().next().value as string | undefined);
      const destination = destinations.values().next().value as
        | { pageIndex: number; rects: readonly Rect[] }
        | undefined;
      if (destinations.size > 1) {
        return { kind: "unresolved", label };
      }
      if (invalidInternalTarget) {
        return { kind: "unresolved", label };
      }
      if (!referenceText && !destination) {
        return citationTextAmbiguous
          ? { kind: "unresolved", label }
          : undefined;
      }

      const readerRef = makeNativeWeakRef(outerReader);
      const primaryViewRef = makeNativeWeakRef(host.primaryView);
      const pdfDocumentRef = makeNativeWeakRef(host.pdfDocument);
      if (!readerRef || !primaryViewRef || !pdfDocumentRef) return undefined;
      const handle = `linked-ref-${this.nextHandle++}`;
      this.records.set(handle, {
        handle,
        label,
        sourceAttachmentItemID,
        destinationPageIndex: destination?.pageIndex,
        destinationRects: destination?.rects,
        referenceText,
        readerRef,
        primaryViewRef,
        pdfDocumentRef,
      });
      this.capRecords();
      return { kind: "linked", handle, label };
    } catch {
      return undefined;
    }
  }

  async resolve(
    outerReader: unknown,
    capture: NativeLinkedReferenceCapture,
  ): Promise<NativeLinkedReferenceEvidence> {
    if (capture.kind === "unresolved") return capture;
    const noEvidence: NativeLinkedReferenceEvidence = {
      kind: "no-evidence",
      label: capture.label,
    };
    const unresolved: NativeLinkedReferenceEvidence = {
      kind: "unresolved",
      label: capture.label,
    };
    if (!this.enabled || !isNativeObject(outerReader)) return noEvidence;
    const record = this.records.get(capture.handle);
    if (
      !record ||
      record.label !== capture.label ||
      record.readerRef.deref() !== outerReader ||
      readOwnPrimitive(outerReader, "itemID") !== record.sourceAttachmentItemID
    ) {
      return noEvidence;
    }

    try {
      let read = this.readHost(outerReader);
      if (!this.isSameHost(read, record)) return noEvidence;
      // A marker-local PDF destination is stronger evidence than Zotero's
      // document-level numeric reference lookup when chapter numbering can
      // restart. In the defensive case where both overlays survive, resolve
      // the one linked page and never let the global text override it.
      if (
        record.destinationPageIndex !== undefined &&
        record.destinationRects
      ) {
        let page = readOwnObjectSlot(
          read.host.pdfPages,
          record.destinationPageIndex,
        );
        const existingChars = page ? readOwnArray(page, "chars") : undefined;
        if (
          !page ||
          !existingChars ||
          readOwnArrayLength(existingChars) === 0
        ) {
          await this.ensureTargetPage(read.host, record.destinationPageIndex);
          read = this.readHost(outerReader);
          if (!this.isSameHost(read, record)) return noEvidence;
          page = readOwnObjectSlot(
            read.host.pdfPages,
            record.destinationPageIndex,
          );
        }
        if (!page) return noEvidence;
        const chars = copyPrimitiveChars(readOwnArray(page, "chars"));
        if (!chars) return noEvidence;
        if (this.records.get(capture.handle) !== record) return noEvidence;
        const extraction = classifyLinkedReferenceText(
          chars,
          record.label,
          record.destinationRects,
        );
        if (extraction.kind === "ambiguous") return unresolved;
        return extraction.kind === "text"
          ? {
              kind: "resolved",
              label: record.label,
              text: extraction.text,
              source: "link-target",
            }
          : noEvidence;
      }
      if (record.referenceText) {
        return this.records.get(capture.handle) === record
          ? {
              kind: "resolved",
              label: record.label,
              text: record.referenceText,
              source: "citation-overlay",
            }
          : noEvidence;
      }
      return noEvidence;
    } catch {
      return noEvidence;
    }
  }

  shutdown(): void {
    this.stopped = true;
    this.records.clear();
  }

  private get enabled(): boolean {
    return (
      !this.stopped &&
      this.profile.status === "audited-zotero-10" &&
      this.runtimeEnabled()
    );
  }

  private readHost(outerReader: unknown): HostRead {
    const root = openNativeWaivedRoot(outerReader);
    if (root.kind !== "ready") return { kind: "unavailable" };
    const primary = readNativeOwnData(root.waivedRoot, "_primaryView");
    if (primary.kind !== "value" || !isNativeObject(primary.value)) {
      return { kind: "unavailable" };
    }
    const iframeWindow = readNativeOwnData(primary.value, "_iframeWindow");
    if (iframeWindow.kind !== "value" || !isNativeObject(iframeWindow.value)) {
      return { kind: "unavailable" };
    }
    const app = readNativeOwnData(iframeWindow.value, "PDFViewerApplication");
    if (app.kind !== "value" || !isNativeObject(app.value)) {
      return { kind: "unavailable" };
    }
    const document = readNativeOwnData(app.value, "pdfDocument");
    const pages = readNativeOwnData(primary.value, "_pdfPages");
    if (
      document.kind !== "value" ||
      !isNativeObject(document.value) ||
      pages.kind !== "value" ||
      !isNativeObject(pages.value)
    ) {
      return { kind: "unavailable" };
    }
    // Deliberate audited exception to the data-descriptor-only reads above:
    // PDFDocumentProxy.numPages is pdf.js's public synchronous accessor. Read
    // only this bounded primitive inside the caller's try/catch; no host object
    // or collection escapes this compartment boundary.
    const numPages = (document.value as any).numPages;
    if (!Number.isSafeInteger(numPages) || numPages <= 0) {
      return { kind: "unavailable" };
    }
    return {
      kind: "ready",
      host: {
        primaryView: primary.value,
        pdfDocument: document.value,
        pdfPages: pages.value,
        numPages,
      },
    };
  }

  private isSameHost(
    read: HostRead,
    record: LinkedCaptureRecord,
  ): read is { kind: "ready"; host: NativeLinkedHost } {
    return (
      read.kind === "ready" &&
      read.host.primaryView === record.primaryViewRef.deref() &&
      read.host.pdfDocument === record.pdfDocumentRef.deref() &&
      (record.destinationPageIndex === undefined ||
        record.destinationPageIndex < read.host.numPages)
    );
  }

  private async ensureTargetPage(
    host: NativeLinkedHost,
    pageIndex: number,
  ): Promise<void> {
    let loads = this.pageLoads.get(host.pdfDocument);
    if (!loads) {
      loads = new Map();
      this.pageLoads.set(host.pdfDocument, loads);
    }
    const existing = loads.get(pageIndex);
    if (existing) return existing;
    const promise = this.callEnsureBasicPageData(host.primaryView, pageIndex);
    loads.set(pageIndex, promise);
    try {
      await promise;
    } finally {
      loads.delete(pageIndex);
    }
  }

  private async callEnsureBasicPageData(
    primaryView: object,
    pageIndex: number,
  ): Promise<void> {
    let method: unknown;
    // Zotero currently defines this on the immediate prototype, but walk a
    // small bounded chain so a harmless class-layer refactor does not disable
    // marker-local lookup. Data descriptors only: never invoke a host getter.
    let owner: object | null = primaryView;
    for (let depth = 0; owner && depth < 4; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(
        owner,
        "_ensureBasicPageData",
      );
      if (descriptor && "value" in descriptor) {
        method = descriptor.value;
        break;
      }
      owner = Object.getPrototypeOf(owner);
    }
    if (typeof method !== "function") {
      throw new TypeError("Zotero page loader unavailable");
    }
    await Promise.resolve(Reflect.apply(method, primaryView, [pageIndex]));
  }

  private capRecords(): void {
    while (this.records.size > NATIVE_OVERLAY_LIMITS.maxLinkedCaptures) {
      const oldest = this.records.keys().next().value as
        | NativeLinkedReferenceHandle
        | undefined;
      if (!oldest) break;
      this.records.delete(oldest);
    }
  }
}

function readOwnPrimitive(target: object, key: PropertyKey): unknown {
  const read = readNativeOwnData(target, key);
  return read.kind === "value" ? read.value : undefined;
}

function readOwnArray(target: object, key: PropertyKey): object | undefined {
  const value = readOwnPrimitive(target, key);
  return Array.isArray(value) && isNativeObject(value) ? value : undefined;
}

function readOwnArrayLength(value: object): number | undefined {
  const length = readOwnPrimitive(value, "length");
  return Number.isSafeInteger(length) && (length as number) >= 0
    ? (length as number)
    : undefined;
}

function readOwnObjectSlot(target: object, index: number): object | undefined {
  const value = readOwnPrimitive(target, String(index));
  return isNativeObject(value) ? value : undefined;
}

/** Copy the exact reference text that Zotero attached to one citation overlay. */
function copyCitationReferenceText(
  overlay: object,
  label: string,
  budget: LinkedCaptureBudget,
): CitationReferenceCopy {
  const referencesValue = readOwnPrimitive(overlay, "references");
  if (referencesValue == null) return { kind: "none" };
  if (!Array.isArray(referencesValue) || !isNativeObject(referencesValue)) {
    return { kind: "ambiguous" };
  }
  const references = referencesValue;
  const length = readOwnArrayLength(references);
  if (length === 0) return { kind: "none" };
  if (
    length === undefined ||
    length > NATIVE_OVERLAY_LIMITS.maxLinkedReferencesPerCitation
  ) {
    return { kind: "ambiguous" };
  }
  if (
    budget.referenceSlots + length >
    NATIVE_OVERLAY_LIMITS.maxLinkedCaptureReferenceSlots
  ) {
    budget.exhausted = true;
    return { kind: "ambiguous" };
  }
  budget.referenceSlots += length;

  const targetIndex = Number.parseInt(label, 10);
  let indexedReferenceCount = 0;
  let indexedTargetCount = 0;
  let indexedTargetText: string | undefined;
  let singleUnindexedText: string | undefined;
  let unindexedTargetCount = 0;
  let everyUnindexedMarkerKnown = true;
  for (let sourceIndex = 0; sourceIndex < length; sourceIndex++) {
    const reference = readOwnPrimitive(references, String(sourceIndex));
    if (!isNativeObject(reference)) return { kind: "ambiguous" };
    const text = readOwnPrimitive(reference, "text");
    if (
      typeof text !== "string" ||
      text.length > NATIVE_OVERLAY_LIMITS.maxLinkedReferenceTextUnits ||
      text.trim().length === 0
    ) {
      return { kind: "ambiguous" };
    }
    budget.textUnits += text.length;
    if (budget.textUnits > NATIVE_OVERLAY_LIMITS.maxLinkedCaptureTextUnits) {
      budget.exhausted = true;
      return { kind: "ambiguous" };
    }

    const nativeIndex = readOwnPrimitive(reference, "index");
    if (
      nativeIndex !== undefined &&
      (!Number.isSafeInteger(nativeIndex) || (nativeIndex as number) <= 0)
    ) {
      return { kind: "ambiguous" };
    }
    if (nativeIndex !== undefined) {
      const marker = readLeadingNumericMarker(text);
      if (marker !== undefined && Number.parseInt(marker, 10) !== nativeIndex) {
        return { kind: "ambiguous" };
      }
      indexedReferenceCount++;
      if (nativeIndex === targetIndex) {
        indexedTargetCount++;
        indexedTargetText = text;
      }
    } else {
      const marker = readLeadingNumericMarker(text);
      if (marker === undefined) {
        everyUnindexedMarkerKnown = false;
      } else if (numericMarkerMatchesLabel(marker, label)) {
        unindexedTargetCount++;
      }
      if (length === 1) singleUnindexedText = text;
    }
  }

  // One exact numeric index is unambiguous. A single reference without any
  // index is also safe because the overlay has only one possible target. In
  // both cases, require the copied text to carry the requested printed marker:
  // Zotero 10 derives `reference.index` from that text, and this defensive
  // agreement check also fails closed if a future host changes the field's
  // semantics. Never concatenate several unlabeled/duplicate-index references
  // and call them exact evidence for one selected number.
  if (indexedTargetCount > 1) return { kind: "ambiguous" };
  if (indexedTargetCount === 1) {
    const marker = readLeadingNumericMarker(indexedTargetText);
    if (numericMarkerMatchesLabel(marker, label)) {
      return { kind: "text", text: indexedTargetText!.trim() };
    }
    // Any explicit index/marker disagreement already failed closed while the
    // records were copied. An unavailable marker in a defensive format carries
    // no reusable evidence, so the historical cache fallback stays reachable.
    return { kind: "none" };
  }

  if (indexedReferenceCount === length) {
    // A well-formed indexed overlay that simply contains other labels is not
    // evidence against the selected marker.
    return { kind: "none" };
  }
  if (length === 1 && indexedReferenceCount === 0) {
    return numericMarkerMatchesLabel(
      readLeadingNumericMarker(singleUnindexedText),
      label,
    )
      ? { kind: "text", text: singleUnindexedText!.trim() }
      : { kind: "none" };
  }

  if (
    indexedReferenceCount > 0 &&
    unindexedTargetCount === 0 &&
    everyUnindexedMarkerKnown
  ) {
    // A partially indexed host shape can still prove that every copied record
    // names some other printed label. That is absence of target evidence, not
    // ambiguity, so the established cached-list fallback remains reachable.
    return { kind: "none" };
  }

  // Several unindexed records cannot be attributed to one selected marker.
  return { kind: "ambiguous" };
}

function readLeadingNumericMarker(
  text: string | undefined,
): string | undefined {
  if (!text) return undefined;
  const bracketed = text.match(/^\s*\[\s*(\d{1,6})\s*\]/);
  if (bracketed) return bracketed[1];
  const numbered = text.match(/^\s*(\d{1,6})[.)]\s+/);
  if (numbered) return numbered[1];
  return text.match(/^\s*(\d{1,6})\s+(?=\S)/)?.[1];
}

function numericMarkerMatchesLabel(
  marker: string | undefined,
  canonicalLabel: string,
): boolean {
  return (
    marker !== undefined &&
    Number.parseInt(marker, 10) === Number.parseInt(canonicalLabel, 10)
  );
}

function copyPosition(
  value: unknown,
): { pageIndex: number; rects: readonly Rect[] } | undefined {
  if (!isNativeObject(value)) return undefined;
  const pageIndex = readOwnPrimitive(value, "pageIndex");
  const rects = copyRects(readOwnPrimitive(value, "rects"));
  return Number.isSafeInteger(pageIndex) && (pageIndex as number) >= 0 && rects
    ? { pageIndex: pageIndex as number, rects }
    : undefined;
}

function copyRects(value: unknown): readonly Rect[] | undefined {
  if (!Array.isArray(value) || !isNativeObject(value)) {
    return undefined;
  }
  const length = readOwnArrayLength(value);
  if (
    length === undefined ||
    length === 0 ||
    length > NATIVE_OVERLAY_LIMITS.maxLinkedRects
  ) {
    return undefined;
  }
  const rects: Rect[] = [];
  for (let rectIndex = 0; rectIndex < length; rectIndex++) {
    const rect = copyRect(readOwnPrimitive(value, String(rectIndex)));
    if (!rect) return undefined;
    rects.push(rect);
  }
  return rects;
}

function copyRect(value: unknown): Rect | undefined {
  if (!Array.isArray(value) || !isNativeObject(value)) return undefined;
  if (readOwnArrayLength(value) !== 4) return undefined;
  const rect = new Array<number>(4);
  for (let unitIndex = 0; unitIndex < 4; unitIndex++) {
    const unit = readOwnPrimitive(value, String(unitIndex));
    if (
      typeof unit !== "number" ||
      !Number.isFinite(unit) ||
      Math.abs(unit) > 1e7
    ) {
      return undefined;
    }
    rect[unitIndex] = unit;
  }
  return [rect[0], rect[1], rect[2], rect[3]];
}

function rectSetsIntersect(a: readonly Rect[], b: readonly Rect[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (
        Math.min(x[2], y[2]) > Math.max(x[0], y[0]) &&
        Math.min(x[3], y[3]) > Math.max(x[1], y[1])
      ) {
        return true;
      }
    }
  }
  return false;
}

function copyPrimitiveChars(
  value: object | undefined,
): PrimitiveChar[] | undefined {
  if (!value || !Array.isArray(value)) {
    return undefined;
  }
  const length = readOwnArrayLength(value);
  if (
    length === undefined ||
    length === 0 ||
    length > NATIVE_OVERLAY_LIMITS.maxLinkedTargetChars
  ) {
    return undefined;
  }
  const result: PrimitiveChar[] = [];
  try {
    for (let charIndex = 0; charIndex < length; charIndex++) {
      const char = readOwnPrimitive(value, String(charIndex));
      if (!isNativeObject(char)) return undefined;
      const c = readOwnPrimitive(char, "c");
      const rect = copyRect(readOwnPrimitive(char, "rect"));
      if (typeof c !== "string" || c.length > 8 || !rect) return undefined;
      result.push({
        c,
        rect,
        ignorable: readOwnPrimitive(char, "ignorable") === true,
        spaceAfter: readOwnPrimitive(char, "spaceAfter") === true,
        lineBreakAfter: readOwnPrimitive(char, "lineBreakAfter") === true,
        paragraphBreakAfter:
          readOwnPrimitive(char, "paragraphBreakAfter") === true,
      });
    }
  } catch {
    return undefined;
  }
  return result;
}

/** Pure extraction helper exported for regression tests. */
export function extractLinkedReferenceText(
  chars: readonly PrimitiveChar[],
  label: string,
  destinationRects: readonly Rect[],
): string | undefined {
  const extraction = classifyLinkedReferenceText(
    chars,
    label,
    destinationRects,
  );
  return extraction.kind === "text" ? extraction.text : undefined;
}

type LinkedReferenceTextExtraction =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "text"; text: string };

function classifyLinkedReferenceText(
  chars: readonly PrimitiveChar[],
  label: string,
  destinationRects: readonly Rect[],
): LinkedReferenceTextExtraction {
  if (!isCanonicalNumericLabel(label) || destinationRects.length === 0) {
    return { kind: "none" };
  }
  const markers: Array<{
    start: number;
    end: number;
    distance: number;
    verticalDistance: number;
  }> = [];
  for (let i = 0; i < chars.length; i++) {
    const marker = readReferenceMarker(chars, i);
    if (!marker || !numericMarkerMatchesLabel(marker.label, label)) continue;
    const markerRects = chars
      .slice(marker.start, marker.end)
      .map((char) => char.rect);
    markers.push({
      start: marker.start,
      end: marker.end,
      distance: rectDistance(markerRects, destinationRects),
      verticalDistance: rectVerticalDistance(markerRects, destinationRects),
    });
  }
  if (markers.length === 0) return { kind: "none" };
  markers.sort((a, b) => a.distance - b.distance);
  for (let markerIndex = 1; markerIndex < markers.length; markerIndex++) {
    if (
      Math.abs(
        markers[0].verticalDistance - markers[markerIndex].verticalDistance,
      ) < NATIVE_OVERLAY_LIMITS.linkedMarkerAmbiguityDistance
    ) {
      return { kind: "ambiguous" };
    }
  }
  const marker = markers[0];
  let text = "";
  let lineCount = 0;
  for (let i = marker.start; i < chars.length; i++) {
    if (i > marker.start && isReferenceMarkerStart(chars, i)) break;
    const char = chars[i];
    if (!char.ignorable) {
      text += char.c;
      if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) {
        text += " ";
      }
    }
    if (char.lineBreakAfter) lineCount++;
    if (text.length > NATIVE_OVERLAY_LIMITS.maxLinkedReferenceTextUnits) {
      return { kind: "none" };
    }
    if (lineCount >= NATIVE_OVERLAY_LIMITS.maxLinkedReferenceLines) break;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  const markerTextLength = chars
    .slice(marker.start, marker.end)
    .reduce((length, char) => length + char.c.length, 0);
  return normalized.length > markerTextLength + 8
    ? { kind: "text", text: normalized }
    : { kind: "none" };
}

function isCanonicalNumericLabel(label: string): boolean {
  return /^[1-9]\d{0,5}$/.test(label);
}

function isReferenceMarkerStart(
  chars: readonly PrimitiveChar[],
  index: number,
): boolean {
  const marker = readReferenceMarker(chars, index);
  if (!marker) return false;
  // A soft-wrapped continuation can legitimately start with a page number,
  // for example "Biometrika 74,\n33 (1987).". Brackets and punctuation are
  // unambiguous at a line boundary; the bare "27 Author" form may terminate
  // the current entry only at a real paragraph boundary.
  return (
    marker.form !== "bare" ||
    index === 0 ||
    chars[index - 1]?.paragraphBreakAfter === true
  );
}

function readReferenceMarker(
  chars: readonly PrimitiveChar[],
  index: number,
):
  | {
      start: number;
      end: number;
      label: string;
      form: "bracketed" | "punctuated" | "bare";
    }
  | undefined {
  if (index < 0 || index >= chars.length) return undefined;
  if (
    index > 0 &&
    !chars[index - 1].paragraphBreakAfter &&
    !chars[index - 1].lineBreakAfter
  ) {
    return undefined;
  }

  const bracketed = chars[index]?.c === "[";
  let cursor = bracketed ? index + 1 : index;
  let digits = "";
  while (cursor < chars.length && digits.length < 6) {
    const c = chars[cursor]?.c;
    if (!/^\d$/.test(c)) break;
    digits += c;
    cursor++;
  }
  if (!/^\d{1,6}$/.test(digits)) return undefined;
  const terminator = chars[cursor]?.c;
  if (bracketed) {
    if (terminator !== "]") return undefined;
    return {
      start: index,
      end: cursor + 1,
      label: digits,
      form: "bracketed",
    };
  }
  if (terminator === "." || terminator === ")") {
    return {
      start: index,
      end: cursor + 1,
      label: digits,
      form: "punctuated",
    };
  }

  // Some PDF text layers represent "27 Author" either with a literal space
  // character or only `spaceAfter` on the last digit. Accept it at the same
  // real line/paragraph boundary as the punctuation forms, but require later
  // non-whitespace text so an isolated page number is not treated as a marker.
  let textStart = cursor;
  while (textStart < chars.length && /^\s+$/.test(chars[textStart].c)) {
    textStart++;
  }
  const implicitSpace = chars[cursor - 1]?.spaceAfter === true;
  if (
    (textStart > cursor || implicitSpace) &&
    textStart < chars.length &&
    /\S/.test(chars[textStart].c)
  ) {
    return { start: index, end: textStart, label: digits, form: "bare" };
  }
  return undefined;
}

function rectVerticalDistance(a: readonly Rect[], b: readonly Rect[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const x of a) {
    const yCenter = (x[1] + x[3]) / 2;
    for (const y of b) {
      const targetY = (y[1] + y[3]) / 2;
      best = Math.min(best, Math.abs(yCenter - targetY));
    }
  }
  return best;
}

function rectDistance(a: readonly Rect[], b: readonly Rect[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const x of a) {
    const xCenter = (x[0] + x[2]) / 2;
    const yCenter = (x[1] + x[3]) / 2;
    for (const y of b) {
      const targetX = (y[0] + y[2]) / 2;
      const targetY = (y[1] + y[3]) / 2;
      const dx = Math.min(Math.abs(xCenter - targetX), 72);
      const dy = yCenter - targetY;
      best = Math.min(best, dy * dy + dx * dx * 0.01);
    }
  }
  return best;
}
