// ─────────────────────────────────────────────────────────────────────────────
// The citations of a selection in arXiv's HTML version of a paper, told to
// the window for its look-up bar: the citations the selection covers (each
// entry once, in order) and where it ends, once the mouse button is up or a
// key that selects is let go; that there are none any more (the bar goes)
// on a press, a key leaving no selection, scrolling, the view changing size,
// Escape and another page; the page's bibliography, once, with the first
// citations. Structures as arXiv's pages have them (arXiv:2610.02169,
// 2610.00014).
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  CITATIONS_MESSAGE,
  HTML_SELECTION_SCRIPT,
  SELECTION_CITATIONS_MAX,
  SELECTION_MESSAGE,
} from "../src/modules/arxiv/arxivHtmlSelection";

const bibitem = (n: number, text: string, link = "") =>
  `<li id="bib.bib${n}" class="ltx_bibitem">
     <span class="ltx_tag ltx_role_refnum ltx_tag_bibitem">[${n}]</span>
     <span class="ltx_bibblock">${text}</span>
     ${link ? `<span class="ltx_bibblock">External Links: <a href="${link}" class="ltx_ref ltx_href">Document</a></span>` : ""}
     <span class="ltx_bibblock ltx_bib_cited">Cited by: <a href="#S1.p1" class="ltx_ref">§I</a>.</span>
   </li>`;

const PAGE = `<!DOCTYPE html><html><body>
<article class="ltx_document">
<p id="S1.p1" class="ltx_p"><span id="before">The production of Drell–Yan pairs</span>
  <cite class="ltx_cite">[<a id="c69" href="#bib.bib69" class="ltx_ref">69</a>,
    <a id="c13" href="#bib.bib13" class="ltx_ref">13</a>,
    <a id="c13again" href="#bib.bib13" class="ltx_ref">13</a>]</cite>
  <span id="after">has played a role</span>, see Eq. (<a id="eq" href="#S1.E1" class="ltx_ref">1</a>)
  and Section <a id="sec" href="#S2" class="ltx_ref">2</a>.</p>
<p id="many" class="ltx_p">${Array.from(
  { length: SELECTION_CITATIONS_MAX + 1 },
  (_, i) => `<a href="#bib.bib${i + 1}" class="ltx_ref">${i + 1}</a>`,
).join(", ")}</p>
<table id="S1.E1" class="ltx_equation ltx_eqn_table"><tr><td>E</td></tr></table>
<section id="S2" class="ltx_section"><p>Text</p></section>
<div class="zoteroinspire-preview"><a id="boxed" href="#bib.bib69">69</a></div>
<section class="ltx_bibliography"><ul class="ltx_biblist">
${bibitem(13, "C. Duhr, F. Dulat, and B. Mistlberger (2020) Charged current Drell-Yan production at N3LO.", "https://dx.doi.org/10.1007/JHEP11%282020%29143")}
${bibitem(69, "J. C. Collins, D. E. Soper, and G. F. Sterman (1984) All Order Factorization for Drell-Yan Cross-sections.")}
${Array.from({ length: SELECTION_CITATIONS_MAX + 1 }, (_, i) => (i + 1 === 13 ? "" : bibitem(i + 1, `Paper ${i + 1}.`))).join("")}
</ul></section>
</article>
</body></html>`;

/** The page with the script started in it; timers run by the test */
function page() {
  const window = new JSDOM(PAGE, {
    url: "https://arxiv.org/html/2610.02169",
  }).window as DOMWindow;
  const { document } = window;
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: 741,
  });
  // The rectangles of a selection's lines (jsdom has no layout)
  const lines = [
    { left: 200, top: 300, right: 540, bottom: 320 },
    { left: 16, top: 324, right: 120, bottom: 344 },
  ];
  (window.Range.prototype as any).getClientRects = () => lines;
  (window.Range.prototype as any).getBoundingClientRect = () => lines[0];
  const timers: Array<() => void> = [];
  const content = {
    document,
    location: window.location,
    getSelection: () => window.getSelection(),
    setTimeout: (run: () => void) => timers.push(run),
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const sent: Array<[string, any]> = [];
  new window.Function(
    "addEventListener",
    "sendAsyncMessage",
    "content",
    HTML_SELECTION_SCRIPT,
  )(
    (type: string, listener: (event: unknown) => void, capture: boolean) => {
      listeners.set(type, listener);
      window.addEventListener(type, listener as () => void, capture);
    },
    (name: string, data: unknown) => sent.push([name, data]),
    content,
  );
  const element = (id: string) => document.getElementById(id)!;
  /** Select from the start of `from` to the end of `to` */
  const select = (from: Node, to: Node = from) => {
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  };
  /** The mouse button released (button 0 by default) */
  const release = (button = 0) => {
    element("after").dispatchEvent(
      new window.MouseEvent("mouseup", { bubbles: true, button }),
    );
    for (const run of timers.splice(0)) run();
  };
  const selections = () =>
    sent.filter(([name]) => name === SELECTION_MESSAGE).map(([, data]) => data);
  const told = () =>
    sent.filter(([name]) => name === CITATIONS_MESSAGE).map(([, data]) => data);
  return {
    window,
    document,
    content,
    lines,
    listeners,
    sent,
    element,
    select,
    release,
    selections,
    told,
  };
}

describe("arXiv HTML page: the citations of a selection, for the window's look-up bar", () => {
  it("tells the selection's citations (each entry once, in order) and where its last line is, once the button is up", () => {
    const { element, select, release, selections, told, document } = page();
    select(element("before"), element("after"));
    release();
    expect(selections()).toEqual([
      {
        page: "/html/2610.02169",
        citations: [
          { id: "bib.bib69", label: "69" },
          { id: "bib.bib13", label: "13" },
        ],
        rect: { left: 16, top: 324, right: 120, bottom: 344 },
      },
    ]);
    // With the first citations, the page's bibliography: each entry's text
    // without its number and the places citing it, its links
    const [bibliography] = told();
    expect(bibliography.page).toBe("/html/2610.02169");
    expect(bibliography.entries[0]).toEqual({
      id: "bib.bib13",
      text: "C. Duhr, F. Dulat, and B. Mistlberger (2020) Charged current Drell-Yan production at N3LO. External Links: Document",
      links: ["https://dx.doi.org/10.1007/JHEP11%282020%29143"],
    });
    expect(bibliography.entries).toHaveLength(
      document.querySelectorAll(".ltx_bibitem").length,
    );
    // Told once
    select(element("c13"));
    release();
    expect(told()).toHaveLength(1);
    expect(selections().at(-1).citations).toEqual([
      { id: "bib.bib13", label: "13" },
    ]);
  });

  it("takes a selection within one citation (made with the keys)", () => {
    const { element, document, window, release, selections } = page();
    const range = document.createRange();
    range.selectNodeContents(element("c69").firstChild!);
    window.getSelection()!.addRange(range);
    release();
    expect(selections()[0].citations).toEqual([
      { id: "bib.bib69", label: "69" },
    ]);
  });

  it("tells nothing for a selection without citations, with too many, or for another button; the bar goes when a selection without citations follows", () => {
    const { element, select, release, selections, window } = page();
    // Equations and sections are not citations
    select(element("eq"), element("sec"));
    release();
    select(element("many"));
    release();
    select(element("before"), element("after"));
    release(2);
    expect(selections()).toEqual([]);
    // Nor the copies in a preview's box
    select(element("boxed"));
    release();
    expect(selections()).toEqual([]);

    select(element("before"), element("after"));
    release();
    expect(selections()).toHaveLength(1);
    // A click (the selection collapsed): the bar goes, once
    window.getSelection()!.collapse(element("after"), 0);
    release();
    release();
    expect(selections().slice(1)).toEqual([
      { page: "/html/2610.02169", citations: [] },
    ]);
  });

  it("lets the bar go on a press, a key leaving no selection, scrolling the page, the view's size changing, Escape and another page; not for a document within the page", () => {
    const {
      element,
      select,
      release,
      selections,
      window,
      document,
      listeners,
      content,
    } = page();
    const shown = () => {
      select(element("before"), element("after"));
      release();
    };
    const gone = () => selections().at(-1).citations.length === 0;
    shown();
    element("after").dispatchEvent(
      new window.MouseEvent("mousedown", { bubbles: true, buttons: 1 }),
    );
    expect(gone()).toBe(true);

    shown();
    const picture = new JSDOM("<svg></svg>").window.document;
    listeners.get("scroll")!({ target: picture });
    expect(gone()).toBe(false);
    document.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    expect(gone()).toBe(true);

    // Scrolling a preview's box keeps it
    shown();
    const box = document.querySelector(".zoteroinspire-preview")!;
    box.dispatchEvent(new window.Event("scroll"));
    expect(gone()).toBe(false);

    shown();
    const up = (key: string, init: KeyboardEventInit = {}) =>
      document.body.dispatchEvent(
        new window.KeyboardEvent("keyup", { key, bubbles: true, ...init }),
      );
    up("Escape");
    expect(gone()).toBe(true);
    // Keys that do not select (reading on, copying): nothing
    const count = selections().length;
    up(" ");
    up("PageDown");
    up("c", { metaKey: true });
    expect(selections()).toHaveLength(count);
    // Keys that select (Shift, Shift with an arrow): the citations again
    up("Shift");
    expect(gone()).toBe(false);
    up("Escape");
    up("ArrowRight", { shiftKey: true });
    expect(gone()).toBe(false);
    // Ctrl/Cmd+A, also where the layout's letter is another script's
    up("Escape");
    up("ф", { metaKey: true, code: "KeyA" });
    expect(gone()).toBe(false);
    // Copying the selection keeps the bar
    up("c", { metaKey: true });
    up("Meta");
    expect(gone()).toBe(false);
    // A key that moved the selection away (an arrow without Shift)
    window.getSelection()!.collapse(element("after"), 0);
    up("ArrowRight");
    expect(gone()).toBe(true);

    // The view changing size; not a document's within the page
    shown();
    listeners.get("resize")!({ target: picture.defaultView });
    expect(gone()).toBe(false);
    listeners.get("resize")!({ target: content });
    expect(gone()).toBe(true);

    shown();
    listeners.get("pagehide")!({ target: picture });
    expect(gone()).toBe(false);
    listeners.get("pagehide")!({ target: document });
    expect(gone()).toBe(true);
    // Nothing more to tell
    const told = selections().length;
    document.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    expect(selections()).toHaveLength(told);
  });

  it("tells nothing for a selection scrolled out of view (its last line above or below the view)", () => {
    const { element, select, release, selections, lines } = page();
    lines[1] = { left: 16, top: -60, right: 120, bottom: -40 };
    select(element("before"), element("after"));
    release();
    lines[1] = { left: 16, top: 760, right: 120, bottom: 780 };
    release();
    expect(selections()).toEqual([]);
  });

  it("tells the bibliography again for another page", () => {
    const { element, select, release, told, listeners, document } = page();
    select(element("before"), element("after"));
    release();
    listeners.get("pagehide")!({ target: document });
    select(element("before"), element("after"));
    release();
    expect(told()).toHaveLength(2);
  });
});
