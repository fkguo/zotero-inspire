// ─────────────────────────────────────────────────────────────────────────────
// The citations in a selection of arXiv's HTML version of a paper, for the
// window's look-up bar (CitationCards), as the plugin's look-up in Zotero's
// PDF reader: text selected across citations ("… in [12, 13] …") gives a
// bar with their numbers, and the pointer on a number shows INSPIRE's card
// of that reference. (The pointer resting on a citation itself shows the
// page's entry, as Zotero's reader shows its preview: arxivHtmlPreview.)
// When a mouse button is released or a key that selects (Shift with a key,
// Ctrl/Cmd+A) is let go in the page, the script tells the window the
// citations of the selection (links to entries of the bibliography, each
// entry once, in order) and where the selection's last line is, when that
// is in view; it tells the window when there are none any more, and when
// the bar is to go: a press in the page, a key that leaves no selection,
// scrolling the page, the view changing size, Escape, another page. With
// the first citations, the window is told the page's bibliography, to
// match it to INSPIRE's reference list of the paper (htmlReferences).
// ─────────────────────────────────────────────────────────────────────────────

/** The page's entries of its bibliography, for the window */
export const CITATIONS_MESSAGE = "zoteroinspire:arxiv-html-citations";
/** The citations of the selection, or none */
export const SELECTION_MESSAGE = "zoteroinspire:arxiv-html-selection";

/**
 * Citations in a selection, at most: a selection of more (a whole page) is
 * not a look-up
 */
export const SELECTION_CITATIONS_MAX = 30;

/**
 * Source of a script for a page's process (a frame script). Its functions
 * and variables are named citations*, so that it can be put into another
 * frame script.
 */
export const HTML_SELECTION_SCRIPT = `
/** The window shows a bar for the selection's citations */
var citationsShown = false;
/** The window has been told the page's bibliography */
var citationsTold = false;

/** The page: what the messages are about */
function citationsPage() {
  return content.location.pathname;
}

/** The entry of the bibliography a link leads to, if it is a citation */
function citationsEntryOf(link) {
  var href = link.getAttribute("href");
  if (!href || href.charAt(0) !== "#" || href.length < 2) return null;
  var id;
  try {
    id = decodeURIComponent(href.slice(1));
  } catch (error) {
    return null;
  }
  var target = link.ownerDocument.getElementById(id);
  return target ? target.closest(".ltx_bibitem[id]") : null;
}

/**
 * The selection's citations and the rectangle of its last line, if it has
 * citations (and not too many)
 */
function citationsOfSelection(doc) {
  var selection = doc.defaultView.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  var range = selection.getRangeAt(0);
  var root = range.commonAncestorContainer;
  if (root.nodeType !== 1) root = root.parentElement;
  if (!root) return null;
  // Within one citation (selected with the keys), or across text
  var within = root.closest("a[href]");
  var links = within ? [within] : root.querySelectorAll("a[href^='#']");
  var citations = [];
  var seen = {};
  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    if (!within && !range.intersectsNode(link)) continue;
    // Not the copies in a preview's box
    if (link.closest(".zoteroinspire-preview")) continue;
    var entry = citationsEntryOf(link);
    if (!entry || seen[entry.id]) continue;
    seen[entry.id] = true;
    citations.push({
      id: entry.id,
      label: link.textContent.replace(/\\s+/g, " ").trim(),
    });
  }
  if (!citations.length || citations.length > ${SELECTION_CITATIONS_MAX}) {
    return null;
  }
  var rects = range.getClientRects();
  var last = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  // Scrolled out of view: no bar
  if (last.bottom < 0 || last.top > doc.documentElement.clientHeight) return null;
  return {
    citations: citations,
    rect: { left: last.left, top: last.top, right: last.right, bottom: last.bottom },
  };
}

/** Tell the window the entries of the page's bibliography */
function citationsTellEntries(doc) {
  citationsTold = true;
  var entries = [];
  var items = doc.querySelectorAll(".ltx_bibitem[id]");
  for (var i = 0; i < items.length; i++) {
    var copy = items[i].cloneNode(true);
    var parts = copy.querySelectorAll(".ltx_tag, .ltx_bib_cited");
    for (var j = 0; j < parts.length; j++) parts[j].remove();
    var links = [];
    var anchors = copy.querySelectorAll("a[href]");
    for (var k = 0; k < anchors.length; k++) links.push(anchors[k].href);
    entries.push({
      id: items[i].id,
      text: copy.textContent.replace(/\\s+/g, " ").trim(),
      links: links,
    });
  }
  sendAsyncMessage("${CITATIONS_MESSAGE}", { page: citationsPage(), entries: entries });
}

/** Tell the window the selection's citations, or that there are none */
function citationsReport() {
  var doc = content.document;
  var found = citationsOfSelection(doc);
  if (!found) {
    citationsEnd();
    return;
  }
  if (!citationsTold) citationsTellEntries(doc);
  citationsShown = true;
  sendAsyncMessage("${SELECTION_MESSAGE}", {
    page: citationsPage(),
    citations: found.citations,
    rect: found.rect,
  });
}

/** The window's bar goes */
function citationsEnd() {
  if (!citationsShown) return;
  citationsShown = false;
  sendAsyncMessage("${SELECTION_MESSAGE}", { page: citationsPage(), citations: [] });
}

// The selection is made: once the button is up (the page has the selection
// then), with the keys
addEventListener("mouseup", function (event) {
  if (event.button === 0) content.setTimeout(citationsReport, 0);
}, true);
addEventListener("keyup", function (event) {
  if (event.key === "Escape") {
    citationsEnd();
    return;
  }
  var key = event.key.toLowerCase();
  // Ctrl/Cmd+A, also with a keyboard of another script
  var all = (event.ctrlKey || event.metaKey) && (key === "a" || event.code === "KeyA");
  if (event.shiftKey || key === "shift" || all) citationsReport();
  // A key that moved the selection away (an arrow without Shift)
  else if (content.getSelection().isCollapsed) citationsEnd();
}, true);
// Another selection begins; the page moves under the bar
addEventListener("mousedown", citationsEnd, true);
addEventListener("scroll", function (event) {
  var target = event.target;
  // The page, not a document within it, nor a preview's box
  if ((target.ownerDocument || target) !== content.document) return;
  if (target.closest && target.closest(".zoteroinspire-preview")) return;
  citationsEnd();
}, true);
// The text flows anew in a view of another size
addEventListener("resize", function (event) {
  if (event.target === content) citationsEnd();
}, true);
addEventListener("pagehide", function (event) {
  if (event.target !== content.document) return;
  citationsEnd();
  citationsTold = false;
}, true);
`;
