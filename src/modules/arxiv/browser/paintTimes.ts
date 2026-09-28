// ─────────────────────────────────────────────────────────────────────────────
// How long the arXiv browser takes to show a page: from the start of drawing
// the page to the first frame painted after it (two animation frames later),
// and to the rendering of the formulas of the abstracts first in view. The
// last pages drawn are kept and written to Zotero's debug output; the plugin
// also lists them with Zotero.ZoteroInspire.arxivBrowserPaintTimes() (Tools →
// Developer → Run JavaScript).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";

export interface PaintTime {
  /** Papers on the page */
  papers: number;
  pageSize: number;
  /** Building the page's elements, in ms */
  buildMs: number;
  /** From the start to the first frame painted with the page, in ms */
  paintMs: number;
  /**
   * From the start to the rendered formulas of the abstracts first in view,
   * in ms (absent until then, or when none was in view)
   */
  formulasMs?: number;
  /** When the page was drawn */
  at: string;
}

const KEPT = 50;
const times: PaintTime[] = [];

const round = (ms: number) => Math.round(ms * 10) / 10;

/**
 * Note a page whose drawing started at `started` (performance.now() of
 * `win`) and whose elements are in place now. Returns the entry, which
 * `noteFormulas` completes later.
 */
export function notePaint(
  win: Window,
  papers: number,
  pageSize: number,
  started: number,
): PaintTime {
  const time: PaintTime = {
    papers,
    pageSize,
    buildMs: round(win.performance!.now() - started),
    paintMs: NaN,
    at: new Date().toISOString(),
  };
  times.push(time);
  if (times.length > KEPT) times.shift();
  // The second frame comes after the page has been painted once
  win.requestAnimationFrame(() =>
    win.requestAnimationFrame(() => {
      time.paintMs = round(win.performance!.now() - started);
      Zotero.debug(
        `[${config.addonName}] arXiv browser: page of ${papers} papers (${pageSize} per page) built in ${time.buildMs} ms, painted after ${time.paintMs} ms`,
      );
    }),
  );
  return time;
}

/** The formulas of the abstracts first in view of a page are rendered */
export function noteFormulas(
  win: Window,
  time: PaintTime,
  started: number,
  abstracts: number,
): void {
  time.formulasMs = round(win.performance!.now() - started);
  Zotero.debug(
    `[${config.addonName}] arXiv browser: formulas of ${abstracts} abstracts in view rendered after ${time.formulasMs} ms`,
  );
}

/** The pages drawn last, oldest first */
export function paintTimes(): PaintTime[] {
  return times.map((time) => ({ ...time }));
}
