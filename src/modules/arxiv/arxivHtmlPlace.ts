// ─────────────────────────────────────────────────────────────────────────────
// The reader's place in arXiv's HTML version of a paper, for the arXiv
// browser's Back and Forward: the page tells the window when it moved
// within its own history — a jump to a `#` place in it (a section, a
// citation, a footnote), or Back and Forward through such jumps
// (hashchange) — and when a page was shown (pageshow); the window then
// reads the page's session history. About 300 ms after the page stopped
// scrolling, it tells the window where the reader is: the innermost element
// with an id (arXiv's pages give one to every section, paragraph, equation
// and reference) across the top of the view — the paragraph being read,
// not its section — so that the window can bring the reader back there
// after the page was closed.
// The listeners capture: the page's hashchange reaches the frame script's
// global only so (measured in Zotero 10.0.5).
// ─────────────────────────────────────────────────────────────────────────────

/** The page moved in its history, was shown, or the reader's place */
export const PLACE_MESSAGE = "zoteroinspire:arxiv-html-place";

/** The wait after the last scroll before the place is told */
export const PLACE_SCROLL_WAIT_MS = 300;

/** What the page tells: `move` and `shown` with its address, `place` the id */
export interface PlaceReport {
  kind: "move" | "shown" | "place";
  /** The page's path: a report from a page shown before is not this one's */
  page: string;
  /** The page's address (with the `#` place, if any) */
  href: string;
  /** `place`: the id of the element at the top of the view */
  id?: string;
}

/**
 * Source of a script for a page's process (a frame script). Its functions
 * and variables are named place*, so that it can be put into another frame
 * script.
 */
export const HTML_PLACE_SCRIPT = `
var placeTimer = null;
function placeTell(kind, id) {
  sendAsyncMessage("${PLACE_MESSAGE}", {
    kind: kind,
    page: content.location.pathname,
    href: content.location.href,
    id: id || "",
  });
}
/**
 * The innermost element with an id across the top of the view (elements
 * come in document order, an element after those it is in); between
 * elements, the first one below the top
 */
function placeTop() {
  var doc = content.document;
  var main = doc.querySelector("article") || doc.body;
  if (!main) return "";
  var elements = main.querySelectorAll("[id]");
  var across = "";
  for (var i = 0; i < elements.length; i++) {
    var box = elements[i].getBoundingClientRect();
    if (box.height <= 0) continue;
    if (box.top <= 1 && box.bottom > 1) across = elements[i].id;
    else if (box.top > 1) return across || elements[i].id;
  }
  return across;
}
addEventListener("hashchange", function (event) {
  if (event.target === content) placeTell("move");
}, true);
addEventListener("pageshow", function (event) {
  if (event.target === content.document) placeTell("shown");
}, true);
addEventListener("scroll", function (event) {
  var target = event.target;
  // The page, not a document within it, nor a preview's box
  if ((target.ownerDocument || target) !== content.document) return;
  if (target.closest && target.closest(".zoteroinspire-preview")) return;
  if (placeTimer !== null) content.clearTimeout(placeTimer);
  placeTimer = content.setTimeout(function () {
    placeTimer = null;
    var id = placeTop();
    if (id) placeTell("place", id);
  }, ${PLACE_SCROLL_WAIT_MS});
}, true);
`;
