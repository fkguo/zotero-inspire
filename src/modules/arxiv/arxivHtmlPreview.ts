// ─────────────────────────────────────────────────────────────────────────────
// Previews in arXiv's HTML version of a paper: the pointer resting on a link
// to an equation, a figure, a table or an entry of the bibliography shows
// that element in a small box beside the link, as Zotero's reader does for
// the footnotes of an EPUB book: a copy of the element, in the page itself,
// so that arXiv's own styles and its formulas (MathML) apply to it.
// arXiv's pages are made by LaTeXML: a link within the page is
// <a href="#id">; the element it leads to is, for an equation, a table of
// class ltx_eqn_table (a row or a group of rows of it for one equation of a
// group, or one line), for a figure or a table a <figure> (a panel of a
// figure: the figure), for a reference an <li class="ltx_bibitem">. Links to
// other elements (sections, footnotes, theorems) show nothing.
// The box shows an equation as the lines the link names, with their number;
// a figure or a table with its caption, its pictures scaled to the box; an
// entry of the bibliography with its links, without arXiv's list of the
// places citing it. It appears after a short rest of the pointer, stays
// while the pointer is on the link or in the box, and goes when the pointer
// has left both, on a click elsewhere, on scrolling, on Escape, and when the
// view changes size. Links in the box work as in the page; pointing at them
// shows nothing more. Nothing appears while a mouse button is held (text
// being selected).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Source of a script for a page's process (a frame script): the previews.
 * Its functions and variables are named preview*, so that it can be put into
 * another frame script.
 */
export const HTML_PREVIEW_SCRIPT = `
/** The box, while it is shown (an element of the page) */
var previewBox = null;
/** The link whose element the box shows */
var previewLink = null;
/** The link whose box is to appear */
var previewNext = null;
var previewShowTimer = 0;
var previewHideTimer = 0;
/** Milliseconds the pointer rests on a link before its box appears */
var PREVIEW_SHOW_DELAY = 250;
/** Milliseconds after the pointer has left the link and the box */
var PREVIEW_HIDE_DELAY = 200;
/** Pixels between the box and the view's edges, and the link */
var PREVIEW_MARGIN = 8;
var PREVIEW_GAP = 4;
/** The box's width at most: a figure, a table, an equation; an entry */
var PREVIEW_WIDTH = 640;
var PREVIEW_ENTRY_WIDTH = 480;

/** The element a link within the page leads to, if one shown in a box */
function previewTargetOf(link) {
  var href = link.getAttribute("href");
  if (!href || href.charAt(0) !== "#" || href.length < 2) return null;
  var id;
  try {
    id = decodeURIComponent(href.slice(1));
  } catch (error) {
    return null;
  }
  var target = link.ownerDocument.getElementById(id);
  return target &&
    target.closest(".ltx_eqn_table, .ltx_bibitem, figure")
    ? target
    : null;
}

/**
 * A copy of what the box shows for \`target\`: the equation's lines the
 * link names (in the table of the equation, for its columns); the whole
 * table when the link names a row without formula (as arXiv's links to an
 * equation group can). The figure, the outermost when \`target\` is a
 * panel of one. The entry, without the places citing it.
 */
function previewCopyOf(target) {
  var equation = target.closest(".ltx_eqn_table");
  if (equation) {
    if (target === equation || !target.querySelector("math")) {
      return equation.cloneNode(true);
    }
    var copy = target.cloneNode(true);
    for (var parent = target.parentElement; parent; parent = parent.parentElement) {
      var shell = parent.cloneNode(false);
      shell.appendChild(copy);
      copy = shell;
      if (parent === equation) break;
    }
    return copy;
  }
  var entry = target.closest(".ltx_bibitem");
  if (entry) {
    copy = entry.cloneNode(true);
    var cited = copy.querySelectorAll(".ltx_bib_cited");
    for (var i = 0; i < cited.length; i++) cited[i].remove();
    // arXiv's layout of the bibliography in a narrow page: the number,
    // then the entry's text
    copy.style.display = "block";
    for (var j = 0; j < copy.children.length; j++) {
      copy.children[j].style.display = "inline";
    }
    var number = copy.querySelector(".ltx_tag");
    if (number) number.style.marginInlineEnd = "0.5em";
    return copy;
  }
  var figure = target.closest("figure");
  var outer;
  while (figure.parentElement && (outer = figure.parentElement.closest("figure"))) {
    figure = outer;
  }
  copy = figure.cloneNode(true);
  copy.style.margin = "0";
  var pictures = copy.querySelectorAll("img, svg, object");
  for (var k = 0; k < pictures.length; k++) {
    // Not the pictures' parts (an SVG's own elements)
    if (pictures[k].parentElement.closest("svg")) continue;
    var style = pictures[k].style;
    style.minWidth = "0";
    style.maxWidth = "100%";
    style.maxHeight = "35vh";
    style.width = "auto";
    style.height = "auto";
  }
  return copy;
}

function previewCancelShow() {
  if (previewShowTimer) content.clearTimeout(previewShowTimer);
  previewShowTimer = 0;
  previewNext = null;
}

function previewCancelHide() {
  if (previewHideTimer) content.clearTimeout(previewHideTimer);
  previewHideTimer = 0;
}

function previewHide() {
  previewCancelShow();
  previewCancelHide();
  if (previewBox) previewBox.remove();
  previewBox = null;
  previewLink = null;
}

/** The box for \`link\`, beside it: below, or above when there is more room */
function previewShow(link) {
  previewShowTimer = 0;
  previewNext = null;
  var target = link.isConnected && previewTargetOf(link);
  if (!target) return;
  var doc = link.ownerDocument;
  if (previewBox) previewBox.remove();
  var box = doc.createElement("div");
  box.className = "zoteroinspire-preview";
  // arXiv's colours and its text's font (the page's text has them from
  // the elements around it, which the box is not in)
  box.style.cssText =
    "position: fixed; z-index: 10000; box-sizing: border-box;" +
    " overflow: auto; padding: 8px 12px; text-align: start;" +
    " background: var(--background-color, Canvas);" +
    " color: var(--text-color, CanvasText);" +
    " font-family: var(--text-font-family); font-size: 1rem;" +
    " font-weight: 300; line-height: var(--line-height-prose);" +
    " border: 1px solid rgba(128, 128, 128, 0.5); border-radius: 6px;" +
    " box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);" +
    // Scrolling the box to its end does not go on to scroll the page
    " overscroll-behavior: contain;" +
    " visibility: hidden; top: 0; left: 0;";
  box.appendChild(previewCopyOf(target));
  var view = doc.documentElement;
  var viewWidth = view.clientWidth;
  var viewHeight = view.clientHeight;
  var width = Math.max(
    0,
    Math.min(
      target.closest(".ltx_bibitem") ? PREVIEW_ENTRY_WIDTH : PREVIEW_WIDTH,
      viewWidth - 2 * PREVIEW_MARGIN,
    ),
  );
  box.style.width = width + "px";
  doc.body.appendChild(box);
  if (target.closest(".ltx_eqn_table")) {
    // An equation wider than that: as wide as it is, within the view
    box.style.width = "max-content";
    width = Math.max(
      width,
      Math.min(box.offsetWidth, viewWidth - 2 * PREVIEW_MARGIN),
    );
    box.style.width = width + "px";
  }
  var rect = link.getBoundingClientRect();
  var left = Math.min(rect.left, viewWidth - PREVIEW_MARGIN - width);
  box.style.left = Math.max(PREVIEW_MARGIN, left) + "px";
  var below = viewHeight - rect.bottom - PREVIEW_GAP - PREVIEW_MARGIN;
  var above = rect.top - PREVIEW_GAP - PREVIEW_MARGIN;
  if (box.offsetHeight <= below || below >= above) {
    box.style.top = rect.bottom + PREVIEW_GAP + "px";
    box.style.maxHeight = Math.max(0, below) + "px";
  } else {
    // Held at its lower edge: pictures loading later make it grow upwards
    box.style.top = "auto";
    box.style.bottom = viewHeight - rect.top + PREVIEW_GAP + "px";
    box.style.maxHeight = Math.max(0, above) + "px";
  }
  box.style.visibility = "visible";
  previewBox = box;
  previewLink = link;
}

/**
 * The element of the page an event is at: for an event in a document within
 * the page (the picture of an <object>), the element holding that document
 */
function previewElementOf(event) {
  var node = event.composedTarget || event.target;
  var doc = node && (node.ownerDocument || node);
  while (doc && doc !== content.document) {
    node = doc.defaultView && doc.defaultView.frameElement;
    doc = node && node.ownerDocument;
  }
  return node && node.closest ? node : null;
}

function previewOnPointerOver(event) {
  // A button held: text being selected
  if (event.buttons) return;
  var target = previewElementOf(event);
  if (!target) return;
  if (previewBox && previewBox.contains(target)) {
    previewCancelShow();
    previewCancelHide();
    return;
  }
  var link = target.closest("a[href]");
  if (link && link === previewLink) {
    previewCancelShow();
    previewCancelHide();
    return;
  }
  if (link && previewTargetOf(link)) {
    // The box shown stays until this link's replaces it
    previewCancelHide();
    // From one of the link's parts to another: the rest goes on
    if (link === previewNext) return;
    previewCancelShow();
    previewNext = link;
    previewShowTimer = content.setTimeout(function () {
      previewShow(link);
    }, PREVIEW_SHOW_DELAY);
    return;
  }
  previewCancelShow();
  if (previewBox && !previewHideTimer) {
    previewHideTimer = content.setTimeout(previewHide, PREVIEW_HIDE_DELAY);
  }
}

function previewOnPointerOut(event) {
  // The pointer has left the page (or a document within it)
  if (event.relatedTarget) return;
  previewCancelShow();
  if (previewBox && !previewHideTimer) {
    previewHideTimer = content.setTimeout(previewHide, PREVIEW_HIDE_DELAY);
  }
}

function previewOnPress(event) {
  var target = previewElementOf(event);
  if (previewBox && target && previewBox.contains(target)) return;
  previewHide();
}

function previewOnScroll(event) {
  var target = event.target;
  // The page scrolls: not the box, nor a document within the page
  var doc = target.ownerDocument || target;
  if (doc !== content.document) return;
  if (previewBox && previewBox.contains(target)) return;
  previewHide();
}

addEventListener("mouseover", previewOnPointerOver, false);
addEventListener("mouseout", previewOnPointerOut, false);
addEventListener("mousedown", previewOnPress, true);
addEventListener("scroll", previewOnScroll, true);
addEventListener("keydown", function (event) {
  if (event.key === "Escape") previewHide();
}, true);
// The page's view, and the page: not those of a document within the page
// (the picture of an <object>, also one in the box, has its own)
addEventListener("resize", function (event) {
  if (event.target === content) previewHide();
}, true);
// Another page: the box and the timers were the old one's
addEventListener("pagehide", function (event) {
  if (event.target === content.document) previewHide();
}, true);
`;
