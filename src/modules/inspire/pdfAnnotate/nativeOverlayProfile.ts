import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";
import type { NativeOverlayProfile } from "./nativeOverlayHostProfile";
import {
  isNativeObject as isObject,
  openNativeWaivedRoot,
  readNativeBrowsingContextID,
  readNativeFrameIdentities,
  readNativeOwnData as ownData,
} from "./nativeOverlayBridge";
export {
  AUDITED_ZOTERO_10_BUILD_IDS,
  isAuditedZotero10Build,
  selectNativeOverlayProfile,
} from "./nativeOverlayHostProfile";
export type {
  NativeOverlayProfile,
  NativeOverlayProfileStatus,
} from "./nativeOverlayHostProfile";

export interface NativeDocumentTuple {
  readonly browsingContextID: string;
  readonly innerWindowID: string;
  readonly viewKey: string;
  readonly documentKey: string;
  readonly docID: "d0";
  readonly numPages: number;
}

export type NativeInspection =
  | { kind: "ready"; tuple: NativeDocumentTuple }
  | { kind: "pending"; marker?: string }
  | { kind: "native-page-ineligible"; numPages: number }
  | { kind: "terminal"; code: string }
  | { kind: "incompatible"; code: string; marker?: string };

interface InternalReadyRead {
  kind: "ready";
  tuple: NativeDocumentTuple;
  documentObject: object;
  store: object;
}

type InternalRead =
  | InternalReadyRead
  | Exclude<NativeInspection, { kind: "ready" }>;

/**
 * Narrow synchronous bridge into the source-audited Zotero 10 Reader shape.
 * Every public method returns primitives only. A store is exposed solely to a
 * synchronous visitor and cannot survive the call unless the caller violates
 * the package-private contract.
 */
export class NativeOverlayAdapter {
  constructor(
    readonly profile: NativeOverlayProfile,
    private runtimeEnabled = true,
  ) {}

  disableRuntime(): void {
    this.runtimeEnabled = false;
  }

  get enabled(): boolean {
    return this.runtimeEnabled && this.profile.status === "audited-zotero-10";
  }

  readOriginViewContext(outerReader: unknown): string | undefined {
    if (!this.enabled) return undefined;
    const root = openNativeWaivedRoot(outerReader);
    if (root.kind !== "ready") return undefined;
    try {
      const { waivedRoot, unwaive } = root;
      const first = readNativeBrowsingContextID(waivedRoot, unwaive);
      const second = readNativeBrowsingContextID(waivedRoot, unwaive);
      return first && first === second ? first : undefined;
    } catch {
      return undefined;
    }
  }

  inspect(
    outerReader: unknown,
    expected?: NativeDocumentTuple,
  ): NativeInspection {
    if (!this.enabled) {
      return {
        kind: "terminal",
        code: this.runtimeEnabled
          ? this.profile.status
          : "native-runtime-unavailable",
      };
    }
    const root = openNativeWaivedRoot(outerReader);
    if (root.kind !== "ready") return root;
    try {
      const { waivedRoot, unwaive } = root;
      const pair = this.readPair(waivedRoot, unwaive, expected);
      return pair.kind === "ready"
        ? { kind: "ready", tuple: pair.tuple }
        : pair;
    } catch {
      return { kind: "incompatible", code: "xray-bridge-failure" };
    }
  }

  withReadyStore<T>(
    outerReader: unknown,
    expected: NativeDocumentTuple,
    visitor: (store: object, tuple: NativeDocumentTuple) => T,
  ): { inspection: NativeInspection; value?: T } {
    if (!this.enabled) {
      return {
        inspection: {
          kind: "terminal",
          code: this.runtimeEnabled
            ? this.profile.status
            : "native-runtime-unavailable",
        },
      };
    }
    const root = openNativeWaivedRoot(outerReader);
    if (root.kind !== "ready") return { inspection: root };
    try {
      const { waivedRoot, unwaive } = root;
      const pair = this.readPair(waivedRoot, unwaive, expected);
      if (pair.kind !== "ready") return { inspection: pair };
      if (!this.sameTuple(pair.tuple, expected)) {
        return {
          inspection: { kind: "terminal", code: "document-tuple-changed" },
        };
      }
      try {
        return {
          inspection: { kind: "ready", tuple: pair.tuple } as NativeInspection,
          value: visitor(pair.store, pair.tuple),
        };
      } catch {
        return {
          inspection: { kind: "terminal", code: "native-store-visitor" },
        };
      }
    } catch {
      return {
        inspection: { kind: "incompatible", code: "xray-bridge-failure" },
      };
    }
  }

  private readPair(
    waivedRoot: any,
    unwaive: (value: unknown) => any,
    expected?: NativeDocumentTuple,
  ): InternalRead {
    const first = this.readOnce(waivedRoot, unwaive, expected);
    if (first.kind !== "ready") return first;
    const second = this.readOnce(waivedRoot, unwaive, expected);
    if (second.kind !== "ready") return second;
    if (
      !this.sameTuple(first.tuple, second.tuple) ||
      first.documentObject !== second.documentObject ||
      first.store !== second.store
    ) {
      return { kind: "pending", marker: "tuple-changing" };
    }
    return second;
  }

  private readOnce(
    waivedRoot: any,
    unwaive: (value: unknown) => any,
    expected?: NativeDocumentTuple,
  ): InternalRead {
    const primary = ownData(waivedRoot, "_primaryView");
    if (primary.kind !== "value") {
      return primary.kind === "missing"
        ? { kind: "pending", marker: "primary-view" }
        : { kind: "incompatible", code: "primary-view-shape" };
    }
    if (primary.value == null) {
      return { kind: "pending", marker: "primary-view" };
    }
    if (!isObject(primary.value)) {
      return { kind: "incompatible", code: "primary-view-shape" };
    }
    const iframe = ownData(primary.value, "_iframe");
    if (iframe.kind !== "value") {
      return iframe.kind === "missing"
        ? { kind: "pending", marker: "iframe" }
        : { kind: "incompatible", code: "iframe-shape" };
    }
    if (iframe.value == null) {
      return { kind: "pending", marker: "iframe" };
    }
    if (!isObject(iframe.value)) {
      return { kind: "incompatible", code: "iframe-shape" };
    }

    const identities = readNativeFrameIdentities(iframe.value, unwaive);
    if (identities.kind !== "ready") return identities;
    if (expected) {
      if (
        identities.browsingContextID === expected.browsingContextID &&
        identities.innerWindowID !== expected.innerWindowID
      ) {
        return { kind: "terminal", code: "same-context-navigation" };
      }
      if (identities.browsingContextID !== expected.browsingContextID) {
        return { kind: "pending", marker: identities.marker };
      }
    }

    const iframeWindow = ownData(primary.value, "_iframeWindow");
    if (iframeWindow.kind !== "value") {
      return iframeWindow.kind === "missing"
        ? { kind: "pending", marker: identities.marker }
        : {
            kind: "incompatible",
            code: "iframe-window-shape",
            marker: identities.marker,
          };
    }
    if (iframeWindow.value == null) {
      return { kind: "pending", marker: identities.marker };
    }
    if (!isObject(iframeWindow.value)) {
      return {
        kind: "incompatible",
        code: "iframe-window-shape",
        marker: identities.marker,
      };
    }
    const app = ownData(iframeWindow.value, "PDFViewerApplication");
    if (app.kind !== "value") {
      return app.kind === "missing"
        ? { kind: "pending", marker: identities.marker }
        : {
            kind: "incompatible",
            code: "pdf-application-shape",
            marker: identities.marker,
          };
    }
    if (app.value == null) {
      return { kind: "pending", marker: identities.marker };
    }
    if (!isObject(app.value)) {
      return {
        kind: "incompatible",
        code: "pdf-application-shape",
        marker: identities.marker,
      };
    }
    const loadingTask = ownData(app.value, "pdfLoadingTask");
    if (loadingTask.kind !== "value") {
      return loadingTask.kind === "missing"
        ? { kind: "pending", marker: identities.marker }
        : {
            kind: "incompatible",
            code: "loading-task-shape",
            marker: identities.marker,
          };
    }
    if (loadingTask.value == null) {
      return { kind: "pending", marker: identities.marker };
    }
    if (!isObject(loadingTask.value)) {
      return {
        kind: "incompatible",
        code: "loading-task-shape",
        marker: identities.marker,
      };
    }
    const docID = ownData(loadingTask.value, "docId");
    if (docID.kind !== "value") {
      return docID.kind === "missing"
        ? { kind: "pending", marker: identities.marker }
        : {
            kind: "incompatible",
            code: "document-id-shape",
            marker: identities.marker,
          };
    }
    if (docID.value == null) {
      return { kind: "pending", marker: identities.marker };
    }
    if (typeof docID.value !== "string") {
      return {
        kind: "incompatible",
        code: "document-id-shape",
        marker: identities.marker,
      };
    }
    if (docID.value !== "d0") {
      return /^d\d+$/.test(docID.value)
        ? { kind: "terminal", code: "same-view-second-document" }
        : {
            kind: "incompatible",
            code: "document-id-shape",
            marker: identities.marker,
          };
    }

    const currentDocument = ownData(app.value, "pdfDocument");
    if (currentDocument.kind !== "value") {
      return currentDocument.kind === "missing"
        ? { kind: "pending", marker: `${identities.marker}:d0` }
        : {
            kind: "incompatible",
            code: "pdf-document-shape",
            marker: identities.marker,
          };
    }
    if (currentDocument.value == null) {
      return { kind: "pending", marker: `${identities.marker}:d0` };
    }
    if (!isObject(currentDocument.value)) {
      return {
        kind: "incompatible",
        code: "pdf-document-shape",
        marker: identities.marker,
      };
    }
    const findController = ownData(primary.value, "_findController");
    if (findController.kind !== "value") {
      return findController.kind === "missing"
        ? { kind: "pending", marker: `${identities.marker}:d0` }
        : {
            kind: "incompatible",
            code: "find-controller-shape",
            marker: identities.marker,
          };
    }
    if (findController.value == null) {
      return { kind: "pending", marker: `${identities.marker}:d0` };
    }
    if (!isObject(findController.value)) {
      return {
        kind: "incompatible",
        code: "find-controller-shape",
        marker: identities.marker,
      };
    }
    const findDocument = ownData(findController.value, "_pdfDocument");
    if (findDocument.kind !== "value") {
      return findDocument.kind === "missing"
        ? { kind: "pending", marker: `${identities.marker}:d0` }
        : {
            kind: "incompatible",
            code: "find-document-shape",
            marker: identities.marker,
          };
    }
    if (findDocument.value == null) {
      return { kind: "pending", marker: `${identities.marker}:d0` };
    }
    if (!isObject(findDocument.value)) {
      return {
        kind: "incompatible",
        code: "find-document-shape",
        marker: identities.marker,
      };
    }
    if (findDocument.value !== currentDocument.value) {
      return { kind: "pending", marker: `${identities.marker}:d0` };
    }

    let numPages: unknown;
    try {
      numPages = (currentDocument.value as any).numPages;
    } catch {
      return {
        kind: "incompatible",
        code: "num-pages-shape",
        marker: identities.marker,
      };
    }
    if (numPages == null || numPages === 0) {
      return { kind: "pending", marker: `${identities.marker}:d0` };
    }
    if (!Number.isSafeInteger(numPages) || (numPages as number) < 0) {
      return {
        kind: "incompatible",
        code: "num-pages-shape",
        marker: identities.marker,
      };
    }
    if ((numPages as number) > NATIVE_OVERLAY_LIMITS.maxPages) {
      return { kind: "native-page-ineligible", numPages: numPages as number };
    }
    const store = ownData(primary.value, "_processedPageOverlays");
    if (store.kind === "missing") {
      return { kind: "pending", marker: `${identities.marker}:d0` };
    }
    if (store.kind === "value" && store.value == null) {
      return { kind: "pending", marker: `${identities.marker}:d0` };
    }
    if (store.kind !== "value" || !isObject(store.value)) {
      return {
        kind: "incompatible",
        code: "processed-store-shape",
        marker: identities.marker,
      };
    }

    const viewKey = `${identities.browsingContextID}:${identities.innerWindowID}`;
    return {
      kind: "ready",
      tuple: {
        browsingContextID: identities.browsingContextID,
        innerWindowID: identities.innerWindowID,
        viewKey,
        documentKey: `${viewKey}:d0`,
        docID: "d0",
        numPages: numPages as number,
      },
      documentObject: currentDocument.value,
      store: store.value,
    };
  }

  private sameTuple(a: NativeDocumentTuple, b: NativeDocumentTuple): boolean {
    return (
      a.documentKey === b.documentKey &&
      a.numPages === b.numPages &&
      a.browsingContextID === b.browsingContextID &&
      a.innerWindowID === b.innerWindowID
    );
  }
}
