import type { LLMImageInput } from "./llm/types";
import { stripDataUrlPrefix } from "./llm/media";
import type {
  ReaderSelectionPosition,
  ReaderSelectionRect,
} from "./readerSelection";

export function computeRectsBoundingBox(
  rects: ReaderSelectionRect[] | null | undefined,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!Array.isArray(rects) || rects.length === 0) return null;

  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;

  for (const r of rects) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const a = Number(r[0]);
    const b = Number(r[1]);
    const c = Number(r[2]);
    const d = Number(r[3]);
    if (![a, b, c, d].every((n) => Number.isFinite(n))) continue;

    const left = Math.min(a, c);
    const right = Math.max(a, c);
    const bottom = Math.min(b, d);
    const top = Math.max(b, d);

    x1 = Math.min(x1, left);
    y1 = Math.min(y1, bottom);
    x2 = Math.max(x2, right);
    y2 = Math.max(y2, top);
  }

  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null;
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

export function splitSelectionRectsByPage(
  position: ReaderSelectionPosition | null | undefined,
): Array<{ pageIndex: number; rects: ReaderSelectionRect[] }> {
  const pageIndex =
    typeof position?.pageIndex === "number" && Number.isFinite(position.pageIndex)
      ? Math.max(0, Math.floor(position.pageIndex))
      : null;
  if (pageIndex === null) return [];

  const out: Array<{ pageIndex: number; rects: ReaderSelectionRect[] }> = [];
  if (Array.isArray(position?.rects) && position.rects.length) {
    out.push({ pageIndex, rects: position.rects });
  }
  if (Array.isArray(position?.nextPageRects) && position.nextPageRects.length) {
    out.push({ pageIndex: pageIndex + 1, rects: position.nextPageRects });
  }
  return out;
}

function findCanvasForPageView(pageView: any): HTMLCanvasElement | null {
  if (!pageView) return null;
  const direct =
    (pageView.canvas as HTMLCanvasElement | undefined) ||
    (pageView?.canvasWrapper?.querySelector?.("canvas") as
      | HTMLCanvasElement
      | undefined) ||
    (pageView?.div?.querySelector?.("canvas") as HTMLCanvasElement | undefined);
  return direct || null;
}

function ensureCanvas2D(doc: Document): HTMLCanvasElement {
  const canvas = doc.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function renderCropToPngBase64(params: {
  doc: Document;
  sourceCanvas: HTMLCanvasElement;
  crop: { x: number; y: number; w: number; h: number };
  maxDimPx?: number;
}): string {
  const maxDimPx =
    typeof params.maxDimPx === "number" && params.maxDimPx > 0
      ? Math.floor(params.maxDimPx)
      : 1024;

  const sx = clamp(Math.floor(params.crop.x), 0, params.sourceCanvas.width - 1);
  const sy = clamp(Math.floor(params.crop.y), 0, params.sourceCanvas.height - 1);
  const sw = clamp(
    Math.floor(params.crop.w),
    1,
    params.sourceCanvas.width - sx,
  );
  const sh = clamp(
    Math.floor(params.crop.h),
    1,
    params.sourceCanvas.height - sy,
  );

  const scale =
    Math.max(sw, sh) > maxDimPx ? maxDimPx / Math.max(sw, sh) : 1;
  const tw = Math.max(1, Math.floor(sw * scale));
  const th = Math.max(1, Math.floor(sh * scale));

  const out = ensureCanvas2D(params.doc);
  out.width = tw;
  out.height = th;
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(params.sourceCanvas, sx, sy, sw, sh, 0, 0, tw, th);

  const dataUrl = out.toDataURL("image/png");
  const base64 = stripDataUrlPrefix(dataUrl);
  if (!base64) {
    throw new Error("Failed to encode PNG");
  }
  return base64;
}

export async function captureSelectionImagesFromReader(params: {
  reader: any;
  position: ReaderSelectionPosition;
  doc: Document;
  paddingPx?: number;
  maxDimPx?: number;
}): Promise<LLMImageInput[]> {
  const pages = splitSelectionRectsByPage(params.position);
  if (!pages.length) {
    throw new Error("No selection rectangles found");
  }

  const iframeWin =
    (params.reader?._iframeWindow as Window | undefined) ||
    (params.reader?._iframe?.contentWindow as Window | undefined) ||
    undefined;
  const wrapped = (iframeWin as any)?.wrappedJSObject || iframeWin;
  const app = wrapped?.PDFViewerApplication;
  const pdfViewer = app?.pdfViewer;
  if (!pdfViewer) {
    throw new Error("Zotero Reader PDF viewer not available");
  }

  const padding =
    typeof params.paddingPx === "number" && params.paddingPx >= 0
      ? params.paddingPx
      : 8;

  const out: LLMImageInput[] = [];
  for (const p of pages) {
    const bbox = computeRectsBoundingBox(p.rects);
    if (!bbox) continue;

    const pageView =
      typeof pdfViewer.getPageView === "function"
        ? pdfViewer.getPageView(p.pageIndex)
        : pdfViewer._pages?.[p.pageIndex] || null;
    if (!pageView) {
      throw new Error(`PDF page view not found (pageIndex=${p.pageIndex})`);
    }

    let canvas = findCanvasForPageView(pageView);
    if (!canvas && typeof pageView.draw === "function") {
      await pageView.draw();
      canvas = findCanvasForPageView(pageView);
    }
    if (!canvas) {
      throw new Error(`PDF page not rendered yet (pageIndex=${p.pageIndex})`);
    }

    const viewport = pageView.viewport;
    if (!viewport || typeof viewport.convertToViewportRectangle !== "function") {
      throw new Error("PDF viewport conversion unavailable");
    }

    const rect = viewport.convertToViewportRectangle([
      bbox.x1,
      bbox.y1,
      bbox.x2,
      bbox.y2,
    ]);
    const leftCss = Math.min(rect[0], rect[2]) - padding;
    const topCss = Math.min(rect[1], rect[3]) - padding;
    const widthCss = Math.abs(rect[2] - rect[0]) + padding * 2;
    const heightCss = Math.abs(rect[3] - rect[1]) + padding * 2;

    const vw = Number(viewport.width);
    const vh = Number(viewport.height);
    if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) {
      throw new Error("Invalid PDF viewport size");
    }

    const scaleX = canvas.width / vw;
    const scaleY = canvas.height / vh;

    const crop = {
      x: leftCss * scaleX,
      y: topCss * scaleY,
      w: widthCss * scaleX,
      h: heightCss * scaleY,
    };

    const base64 = renderCropToPngBase64({
      doc: params.doc,
      sourceCanvas: canvas,
      crop,
      maxDimPx: params.maxDimPx,
    });

    out.push({
      mimeType: "image/png",
      data: base64,
      filename: `selection_p${p.pageIndex + 1}.png`,
    });
  }

  if (!out.length) {
    throw new Error("Selection image capture failed");
  }

  return out;
}

