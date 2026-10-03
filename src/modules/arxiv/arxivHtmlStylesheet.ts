// ─────────────────────────────────────────────────────────────────────────────
// arXiv's stylesheet for its HTML papers, put back when a page's own is gone.
// A paper's HTML page links one dated file of arXiv's,
// /static/browse/<version>/css/arxiv-html-papers-<date>.css. arXiv deletes the
// older files when it publishes a new one and serves its pages pointing at
// the new file, but not all of them: some pages still link a deleted file
// (404) and show unstyled, also in a web browser. The script below, run in
// such a page's process, points a link to one of these files that failed to
// load at arXiv's current file instead. Pages whose stylesheet loads are left
// as they are.
// ─────────────────────────────────────────────────────────────────────────────

/** arXiv's current stylesheet for its HTML papers */
export const ARXIV_PAPER_STYLESHEET =
  "/static/browse/0.3.4/css/arxiv-html-papers-20260823.css";

/**
 * Source of the functions of the script below: restorePaperStylesheet(link)
 * points a link to one of arXiv's stylesheets for its HTML papers, other than
 * the current one, at the current one; restoreFailedStylesheets() does so for
 * each such link whose file failed. They are named restore*, so that they can
 * be put into another frame script.
 */
export const RESTORE_STYLESHEET_FUNCTIONS = `
function restorePaperStylesheet(link) {
  if (!link || link.localName !== "link") return;
  if (!/(^|\\s)stylesheet(\\s|$)/i.test(link.rel)) return;
  var url;
  try {
    url = new URL(link.href);
  } catch (error) {
    return;
  }
  if (
    url.hostname !== "arxiv.org" ||
    !/^\\/static\\/browse\\/[^/]+\\/css\\/arxiv-html-papers-\\d+\\.css$/.test(url.pathname) ||
    url.pathname === ${JSON.stringify(ARXIV_PAPER_STYLESHEET)}
  ) {
    return;
  }
  link.href = new URL(${JSON.stringify(ARXIV_PAPER_STYLESHEET)}, url).href;
}
function restoreFailedStylesheets() {
  var links = content.document.querySelectorAll("link[rel~=stylesheet]");
  for (var i = 0; i < links.length; i++) {
    // A file that failed has an empty sheet (Gecko keeps one), or none
    var sheet = links[i].sheet;
    if (!sheet || !sheet.cssRules.length) restorePaperStylesheet(links[i]);
  }
}
`;

/**
 * Source of a script for a page's process (a frame script): a link to one of
 * arXiv's stylesheets for its HTML papers that fails to load, or has failed
 * when the script starts, is pointed at the current stylesheet.
 */
export const RESTORE_STYLESHEET_SCRIPT = `${RESTORE_STYLESHEET_FUNCTIONS}
// A stylesheet's error does not bubble: it is seen on its way down
addEventListener("error", function (event) {
  restorePaperStylesheet(event.target);
}, true);
// The script may start after the error: the page's stylesheets are looked at
// once all have loaded, too
addEventListener("load", function (event) {
  if (event.target === content.document) restoreFailedStylesheets();
}, true);
if (content.document.readyState === "complete") restoreFailedStylesheets();
`;
