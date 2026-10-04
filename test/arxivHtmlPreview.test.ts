// ─────────────────────────────────────────────────────────────────────────────
// Previews in arXiv's HTML version of a paper: the pointer resting on a link
// to an equation, a figure, a table or a reference shows a copy of that
// element in a box beside the link; links to other elements show nothing.
// The page is made of the structures arXiv's pages (LaTeXML) have, taken
// from arXiv:2610.00014, 1810.05653, 2512.03003, 2610.02097 and 2610.02138.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, it } from "vitest";
import { HTML_PREVIEW_SCRIPT } from "../src/modules/arxiv/arxivHtmlPreview";

const math = (tex: string) => `<math alttext="${tex}"><mi>${tex}</mi></math>`;
const row = (id: string, tex: string, tag: string) =>
  `<tr id="${id}" class="ltx_equation ltx_eqn_row ltx_align_baseline">
     <td class="ltx_eqn_cell ltx_eqn_center_padleft"></td>
     <td class="ltx_td ltx_align_left ltx_eqn_cell">${math(tex)}</td>
     <td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">${tag}</span></td>
   </tr>`;

const PAGE = `<!DOCTYPE html><html><head></head><body>
<div class="ltx_page_content"><article class="ltx_document">
<section id="S1" class="ltx_section"><div id="S1.p1" class="ltx_para"><p class="ltx_p">
  theory (<a id="to-eq" href="#S1.E1" class="ltx_ref"><span class="ltx_text ltx_ref_tag">1</span></a>),
  group (<a id="to-17" href="#S2.E17" class="ltx_ref">17</a>),
  line (<a id="to-81a" href="#S5.E81.1" class="ltx_ref">81a</a>),
  whole group (<a id="to-81" href="#A10.EGx21" class="ltx_ref">81</a>),
  Fig. <a id="to-panel" href="#S3.F3.sf1" class="ltx_ref">3a</a>,
  Table <a id="to-table" href="#S7.T1" class="ltx_ref">1</a>,
  <cite class="ltx_cite">[<a id="to-bib" href="#bib.bib4" class="ltx_ref">4</a>]</cite>,
  Section <a id="to-section" href="#S2" class="ltx_ref">2</a>,
  Theorem <a id="to-theorem" href="#Thmtheorem2" class="ltx_ref">2</a>,
  footnote <a id="to-footnote" href="#footnote1" class="ltx_ref">1</a>,
  conditions (<a id="to-98" href="#S4.E98" class="ltx_ref">98</a>),
  <a id="to-nowhere" href="#S9.E9" class="ltx_ref">9</a>,
  <a id="abstract-page" href="https://arxiv.org/abs/2610.00014">abstract</a>,
  <span id="text">plain text</span>
</p>
<table id="S1.E1" class="ltx_equation ltx_eqn_table"><tbody>${row("S1.E1.r", "L", "(1)")}</tbody></table>
</div></section>
<section id="S2" class="ltx_section"><div class="ltx_para">
<table id="A10.EGx5" class="ltx_equationgroup ltx_eqn_align ltx_eqn_table">
  <tbody id="S2.E17">${row("S2.E17.r", "H_1", "(17)")}</tbody>
  <tbody id="S2.E18">${row("S2.E18.r", "H_2", "(18)")}</tbody>
</table>
<table id="S5.E81" class="ltx_equationgroup ltx_eqn_table"><tbody>
  <tr id="A10.EGx21" class="ltx_eqn_row"><td class="ltx_eqn_cell" colspan="5"></td></tr>
  ${row("S5.E81.1", "V^0", "(81a)")}
  ${row("S5.E81.2", "V^1", "(81b)")}
</tbody></table>
<p class="ltx_p">The conditions
<span id="S4.E98" class="ltx_equationgroup ltx_eqn_table"><span>
  <span id="S4.E98X" class="ltx_equation ltx_eqn_row"><span class="ltx_td ltx_eqn_cell">${math("Y_1(1)")}</span>
    <span class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equationgroup">(98)</span></span></span>
  <span id="S4.E98Xa" class="ltx_equation ltx_eqn_row"><span class="ltx_td ltx_eqn_cell">${math("Y_2(1)")}</span></span>
</span></span> hold.</p>
<div id="Thmtheorem2" class="ltx_theorem ltx_theorem_theorem"><p>A theorem.</p></div>
<span id="footnote1" class="ltx_note ltx_role_footnote">a footnote</span>
</div></section>
<figure id="S3.F3" class="ltx_figure">
  <figure id="S3.F3.sf1" class="ltx_figure ltx_figure_panel">
    <img src="x/a.png" id="S3.F3.sf1.g1" class="ltx_graphics" width="598" height="371">
    <figcaption class="ltx_caption">(a)</figcaption>
  </figure>
  <figure id="S3.F3.sf2" class="ltx_figure ltx_figure_panel">
    <svg id="S3.F3.pic" class="ltx_picture" width="200" height="100"><g><path id="S3.F3.path" d="M0 0"></path></g></svg>
    <figcaption class="ltx_caption">(b)</figcaption>
  </figure>
  <figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 3: </span>Separation power, from
    (<a id="caption-link" href="#S1.E1" class="ltx_ref">1</a>).</figcaption>
</figure>
<figure id="S7.T1" class="ltx_table">
  <table class="ltx_tabular"><tr><td class="ltx_td">m [kg]</td></tr></table>
  <figcaption class="ltx_caption">Table 1: Parameters</figcaption>
</figure>
<section id="bib" class="ltx_bibliography"><ul class="ltx_biblist">
  <li id="bib.bib4" class="ltx_bibitem">
    <span class="ltx_tag ltx_role_refnum ltx_tag_bibitem">[4]</span>
    <span class="ltx_bibblock">F. Steininger, T. B. Mieling, and P. T. Chruściel,</span>
    <span class="ltx_bibblock">No Proca photons, <a id="doi" href="https://dx.doi.org/10.1103/PhysRevD.107.056013" class="ltx_ref ltx_href">Phys. Rev. D 107, 056013</a> (2023).</span>
    <span class="ltx_bibblock ltx_bib_cited">Cited by: <a href="#S1.p1" class="ltx_ref">§I</a>.</span>
  </li>
</ul></section>
</article></div>
</body></html>`;

/** Timers run by the test */
function manualClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimeout(run: () => void, delay: number) {
      timers.set(next, { at: now + delay, run });
      return next++;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
  };
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The page with the script started in it, a view of `width`×`height`
 * pixels, every link at `rect`, and the box `boxHeight` pixels tall
 */
function page({
  width = 555,
  height = 741,
  rect = { left: 260, top: 360, width: 6, height: 23 },
  boxHeight = 90,
  boxWidth = 0,
}: {
  width?: number;
  height?: number;
  rect?: Rect;
  boxHeight?: number;
  /** The box's width as its content would have it */
  boxWidth?: number;
} = {}) {
  const window = new JSDOM(PAGE, {
    url: "https://arxiv.org/html/2610.00014",
  }).window as DOMWindow;
  const { document } = window;
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: width,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: height,
  });
  for (const link of document.querySelectorAll("a")) {
    link.getBoundingClientRect = () =>
      ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
      }) as DOMRect;
  }
  const isBox = (element: HTMLElement) =>
    element.classList.contains("zoteroinspire-preview");
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return isBox(this) ? boxHeight : 0;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return isBox(this) && this.style.width === "max-content" ? boxWidth : 0;
    },
  });
  const clock = manualClock();
  const content = {
    document,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  const listeners = new Map<string, (event: unknown) => void>();
  new window.Function("addEventListener", "content", HTML_PREVIEW_SCRIPT)(
    (type: string, listener: (event: unknown) => void, capture: boolean) => {
      listeners.set(type, listener);
      window.addEventListener(type, listener as () => void, capture);
    },
    content,
  );
  const element = (id: string) => document.getElementById(id)!;
  const box = () =>
    document.querySelector<HTMLElement>("body > .zoteroinspire-preview");
  /**
   * The pointer onto the element `id`, or one in the box: out of the
   * element it was on, as a browser tells it
   */
  let under: Element | null = null;
  const over = (target: string | Element, init: MouseEventInit = {}) => {
    const next = typeof target === "string" ? element(target) : target;
    under?.dispatchEvent(
      new window.MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: next,
        ...init,
      }),
    );
    next.dispatchEvent(
      new window.MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: under,
        ...init,
      }),
    );
    under = next;
  };
  /** The pointer rests on the link `id` until its box has appeared */
  const show = (id: string) => {
    over(id);
    clock.advance(250);
    return box();
  };
  return {
    window,
    document,
    content,
    clock,
    listeners,
    element,
    box,
    over,
    show,
  };
}

describe("arXiv HTML page: previews of a link's equation, figure, table or reference", () => {
  it("shows the equation a link leads to, with its number, after a short rest of the pointer", () => {
    const { clock, over, box } = page();
    over("to-eq");
    clock.advance(249);
    expect(box()).toBeNull();
    clock.advance(1);
    const shown = box()!;
    const table = shown.firstElementChild!;
    expect(table.matches("table.ltx_equation.ltx_eqn_table")).toBe(true);
    expect(table.querySelector("math")!.getAttribute("alttext")).toBe("L");
    expect(table.querySelector(".ltx_tag")!.textContent).toBe("(1)");
    // Below the link, at most 640 pixels wide, inside the view
    expect(shown.style.position).toBe("fixed");
    expect(shown.style.width).toBe("539px");
    expect(shown.style.left).toBe("8px");
    expect(shown.style.top).toBe(`${360 + 23 + 4}px`);
    expect(shown.style.maxHeight).toBe(`${741 - 383 - 4 - 8}px`);
    expect(shown.style.visibility).toBe("visible");
    // arXiv's colours and text font
    expect(shown.style.background).toContain("var(--background-color");
    expect(shown.style.fontFamily).toBe("var(--text-font-family)");
    // Scrolling the box to its end does not scroll the page (and close it)
    expect(shown.style.cssText).toContain("overscroll-behavior: contain");
  });

  it("shows of an equation group the equation or the line the link names, and the whole group for a link to a row without formula", () => {
    const { show, element, over, clock } = page();
    const equation = show("to-17")!.firstElementChild!;
    // The group's table, its columns, with this equation only
    expect(equation.className).toBe(
      "ltx_equationgroup ltx_eqn_align ltx_eqn_table",
    );
    expect(
      [...equation.querySelectorAll(".ltx_tag")].map((tag) => tag.textContent),
    ).toEqual(["(17)"]);

    over("text");
    clock.advance(200);
    const line = show("to-81a")!.firstElementChild!;
    expect(line.querySelectorAll("tbody")).toHaveLength(1);
    expect(
      [...line.querySelectorAll(".ltx_tag")].map((tag) => tag.textContent),
    ).toEqual(["(81a)"]);

    over("text");
    clock.advance(200);
    const group = show("to-81")!.firstElementChild!;
    expect(
      [...group.querySelectorAll(".ltx_tag")].map((tag) => tag.textContent),
    ).toEqual(["(81a)", "(81b)"]);
    // The page itself is as it was
    expect(element("S5.E81").querySelectorAll("tr")).toHaveLength(3);
  });

  it("shows an equation group arXiv builds of spans (in a paragraph)", () => {
    const { show } = page();
    const group = show("to-98")!.firstElementChild!;
    expect(group.matches("span.ltx_equationgroup.ltx_eqn_table")).toBe(true);
    expect(group.querySelectorAll("math")).toHaveLength(2);
    expect(group.querySelector(".ltx_tag")!.textContent).toBe("(98)");
  });

  it("shows a figure with its caption, also for a link to one of its panels, its pictures scaled to the box", () => {
    const { show } = page();
    const figure = show("to-panel")!.firstElementChild as HTMLElement;
    expect(figure.matches("figure.ltx_figure:not(.ltx_figure_panel)")).toBe(
      true,
    );
    expect(figure.style.margin).toBe("0px");
    expect(figure.querySelectorAll(".ltx_figure_panel")).toHaveLength(2);
    expect(figure.lastElementChild!.textContent).toContain("Figure 3:");
    const picture = figure.querySelector("img")!;
    expect(picture.style.maxWidth).toBe("100%");
    expect(picture.style.maxHeight).toBe("35vh");
    expect(picture.style.width).toBe("auto");
    expect(picture.style.height).toBe("auto");
    expect(parseFloat(picture.style.minWidth)).toBe(0);
    expect(
      (figure.querySelector("svg") as unknown as HTMLElement).style.maxWidth,
    ).toBe("100%");
    // Not the parts of an SVG picture
    expect(
      (figure.querySelector("path") as unknown as HTMLElement).style.maxWidth,
    ).toBe("");
  });

  it("shows a table with its caption", () => {
    const { show } = page();
    const table = show("to-table")!.firstElementChild!;
    expect(table.matches("figure.ltx_table")).toBe(true);
    expect(table.textContent).toContain("m [kg]");
    expect(table.textContent).toContain("Table 1: Parameters");
  });

  it("shows a reference with its links, without the places citing it, narrower", () => {
    const { show } = page();
    const shown = show("to-bib")!;
    expect(shown.style.width).toBe("480px");
    // Kept inside the view
    expect(shown.style.left).toBe(`${555 - 8 - 480}px`);
    const entry = shown.firstElementChild as HTMLElement;
    expect(entry.matches("li.ltx_bibitem")).toBe(true);
    expect(entry.style.display).toBe("block");
    expect(
      [...entry.children].map((child) => (child as HTMLElement).style.display),
    ).toEqual(["inline", "inline", "inline"]);
    expect(entry.textContent).toContain("[4]");
    expect(entry.textContent).not.toContain("Cited by");
    expect(entry.querySelector("a")!.getAttribute("href")).toBe(
      "https://dx.doi.org/10.1103/PhysRevD.107.056013",
    );
  });

  it("shows nothing for links to sections, theorems, footnotes, missing elements and other pages", () => {
    const { show } = page();
    for (const id of [
      "to-section",
      "to-theorem",
      "to-footnote",
      "to-nowhere",
      "abstract-page",
      "text",
    ]) {
      expect(show(id)).toBeNull();
    }
  });

  it("puts the box above the link when it does not fit below and there is more room above", () => {
    const low = { left: 100, top: 600, width: 6, height: 23 };
    const { show } = page({ rect: low, boxHeight: 300 });
    const shown = show("to-table")!;
    expect(shown.style.top).toBe("auto");
    expect(shown.style.bottom).toBe(`${741 - 600 + 4}px`);
    expect(shown.style.maxHeight).toBe(`${600 - 4 - 8}px`);
    expect(shown.style.left).toBe("8px");
    // Below when it fits there
    const fits = page({ rect: low, boxHeight: 100 }).show("to-table")!;
    expect(fits.style.top).toBe(`${600 + 23 + 4}px`);
    // A narrow view: the box takes its width less the margins
    const narrow = page({ width: 300 }).show("to-eq")!;
    expect(narrow.style.width).toBe(`${300 - 16}px`);
    expect(narrow.style.left).toBe("8px");
    // An equation wider than 640 pixels: as wide as it is, within the view;
    // not so the others
    const wide = { width: 1035, boxWidth: 700 };
    expect(page(wide).show("to-eq")!.style.width).toBe("700px");
    expect(page({ ...wide, boxWidth: 300 }).show("to-eq")!.style.width).toBe(
      "640px",
    );
    const widest = page({ ...wide, boxWidth: 2000 }).show("to-eq")!;
    expect(widest.style.width).toBe(`${1035 - 16}px`);
    // Kept inside the view at that width
    expect(widest.style.left).toBe("8px");
    expect(page(wide).show("to-table")!.style.width).toBe("640px");
    expect(page(wide).show("to-bib")!.style.width).toBe("480px");
  });

  it("stays while the pointer is on the link or in the box, goes when it has left both", () => {
    const { clock, over, show, box, element } = page();
    const shown = show("to-eq")!;
    // Off the link and into the box in time: kept
    over("text");
    clock.advance(150);
    over(shown.querySelector("math")!);
    clock.advance(1000);
    expect(box()).toBe(shown);
    // Back onto the link: kept
    over(element("to-eq").firstElementChild!);
    clock.advance(1000);
    expect(box()).toBe(shown);
    // Elsewhere: gone after a moment
    over("text");
    clock.advance(199);
    expect(box()).toBe(shown);
    clock.advance(1);
    expect(box()).toBeNull();
  });

  it("waits the rest once across the parts of a link; replaces the box shown by another link's only when that one's is ready", () => {
    const { clock, over, box, show, element } = page();
    over("to-eq");
    clock.advance(200);
    over(element("to-eq").firstElementChild!);
    clock.advance(50);
    const first = box()!;
    expect(first).not.toBeNull();

    over("to-bib");
    clock.advance(240);
    expect(box()).toBe(first);
    clock.advance(10);
    expect(box()!.firstElementChild!.matches(".ltx_bibitem")).toBe(true);
    expect(first.isConnected).toBe(false);
    // One box at a time
    show("to-table");
    expect(
      element("to-table").ownerDocument.querySelectorAll(
        ".zoteroinspire-preview",
      ),
    ).toHaveLength(1);
  });

  it("shows nothing while a mouse button is held (text being selected)", () => {
    const { clock, over, box } = page();
    over("to-eq", { buttons: 1 });
    clock.advance(1000);
    expect(box()).toBeNull();
  });

  it("goes on a press outside the box, on scrolling the page, on Escape, when the view changes size, on another page; not for the box's own", () => {
    const { window, document, content, clock, show, box, listeners } = page();
    const press = (target: Element) =>
      target.dispatchEvent(
        new window.MouseEvent("mousedown", { bubbles: true, buttons: 1 }),
      );
    // A press in the box (selecting its text): kept
    let shown = show("to-bib")!;
    press(shown.querySelector(".ltx_bibblock")!);
    expect(box()).toBe(shown);
    press(document.getElementById("text")!);
    expect(box()).toBeNull();

    // The box's own scrolling keeps it, the page's does not
    shown = show("to-bib")!;
    shown.dispatchEvent(new window.Event("scroll"));
    expect(box()).toBe(shown);
    document.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    expect(box()).toBeNull();

    show("to-bib");
    document.body.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(box()).toBeNull();

    // A document within the page (an <object>'s picture): its own view,
    // its own load
    const picture = new JSDOM("<svg></svg>").window.document;
    shown = show("to-bib")!;
    listeners.get("scroll")!({ target: picture });
    listeners.get("resize")!({ target: picture.defaultView });
    listeners.get("pagehide")!({ target: picture });
    expect(box()).toBe(shown);
    listeners.get("resize")!({ target: content });
    expect(box()).toBeNull();
    show("to-bib");
    listeners.get("pagehide")!({ target: document });
    expect(box()).toBeNull();
    // Nothing pending afterwards
    clock.advance(1000);
    expect(box()).toBeNull();
  });

  it("keeps the box while the pointer is in a document within it, and goes when the pointer leaves the page", () => {
    const { window, clock, show, box, over, listeners } = page();
    const shown = show("to-panel")!;
    // A picture's own document in the box: events there are the box's
    const frame = window.document.createElement("iframe");
    shown.appendChild(frame);
    const inner = frame.contentDocument!.createElement("div");
    frame.contentDocument!.body.appendChild(inner);
    listeners.get("mouseover")!({ target: inner, buttons: 0 });
    listeners.get("mousedown")!({ target: inner });
    clock.advance(1000);
    expect(box()).toBe(shown);
    // One in the page, outside the box: the pointer has left the box
    const outside = window.document.createElement("iframe");
    window.document.body.appendChild(outside);
    listeners.get("mouseover")!({
      target: outside.contentDocument!.body,
      buttons: 0,
    });
    clock.advance(200);
    expect(box()).toBeNull();
    show("to-panel");

    // Out of the page (relatedTarget: none): gone, and a box about to
    // appear does not
    over("to-table");
    listeners.get("mouseout")!({ relatedTarget: null });
    clock.advance(1000);
    expect(box()).toBeNull();
  });
});
