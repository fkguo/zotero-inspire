// ─────────────────────────────────────────────────────────────────────────────
// The reader's place in arXiv's HTML version of a paper, told to the window
// for Back and Forward: a move in the page's own history (hashchange), a
// page shown (pageshow), and, once the page has stopped scrolling, the first
// element with an id at the top of the view.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  HTML_PLACE_SCRIPT,
  PLACE_MESSAGE,
} from "../src/modules/arxiv/arxivHtmlPlace";

const PAGE = `<!DOCTYPE html><html><body>
<article class="ltx_document">
<section id="S1"><p id="S1.p1" class="ltx_p">One</p><p id="S1.p2" class="ltx_p">Two</p></section>
<section id="S2"><p id="S2.p1" class="ltx_p">Three</p></section>
<div class="zoteroinspire-preview"><p id="boxed">In a preview</p></div>
</article></body></html>`;

/**
 * The page with the script started in it; timers run by the test. `boxes`:
 * the elements' top and bottom in the view (jsdom has no layout)
 */
function page(boxes: Record<string, [number, number]>) {
  const window = new JSDOM(PAGE, {
    url: "https://arxiv.org/html/2502.20357",
  }).window as DOMWindow;
  const { document } = window;
  for (const element of document.querySelectorAll<HTMLElement>("[id]")) {
    const [top, bottom] = boxes[element.id] ?? [1000, 1040];
    element.getBoundingClientRect = () =>
      ({ top, bottom, height: bottom - top }) as DOMRect;
  }
  // The page's window is `content`; its timers run by the test
  const timers: Array<() => void> = [];
  Object.assign(window, {
    setTimeout: (run: () => void) => timers.push(run) - 1,
    clearTimeout: (id: number) => {
      timers[id] = () => undefined;
    },
  });
  const sent: Array<[string, any]> = [];
  new window.Function(
    "addEventListener",
    "sendAsyncMessage",
    "content",
    HTML_PLACE_SCRIPT,
  )(
    (type: string, listener: (event: unknown) => void, capture: boolean) =>
      window.addEventListener(type, listener as () => void, capture),
    (name: string, data: unknown) => sent.push([name, data]),
    window,
  );
  const runTimers = () => {
    for (const run of timers.splice(0)) run();
  };
  const told = () =>
    sent.filter(([name]) => name === PLACE_MESSAGE).map(([, data]) => data);
  return { window, document, runTimers, told };
}

describe("arXiv HTML page: the reader's place, for Back and Forward", () => {
  it("tells a move in the page's history and a page shown, with the address", () => {
    const { window, document, told } = page({});
    window.location.hash = "#S2";
    window.dispatchEvent(new window.HashChangeEvent("hashchange"));
    document.dispatchEvent(new window.Event("pageshow"));
    expect(told()).toEqual([
      {
        kind: "move",
        page: "/html/2502.20357",
        href: "https://arxiv.org/html/2502.20357#S2",
        id: "",
      },
      {
        kind: "shown",
        page: "/html/2502.20357",
        href: "https://arxiv.org/html/2502.20357#S2",
        id: "",
      },
    ]);
  });

  it("tells the paragraph across the top of the view, not its section, once the page stopped scrolling", () => {
    // Section 1 begins above the view; its first paragraph is above it, its
    // second runs across its top
    const { window, document, runTimers, told } = page({
      S1: [-400, 280],
      "S1.p1": [-380, -100],
      "S1.p2": [-80, 280],
      S2: [300, 900],
      "S2.p1": [320, 600],
    });
    document.dispatchEvent(new window.Event("scroll"));
    document.dispatchEvent(new window.Event("scroll"));
    expect(told()).toEqual([]);
    runTimers();
    expect(told()).toEqual([
      {
        kind: "place",
        page: "/html/2502.20357",
        href: "https://arxiv.org/html/2502.20357",
        id: "S1.p2",
      },
    ]);
  });

  it("tells the first element below the top when the top is between elements", () => {
    const { window, document, runTimers, told } = page({
      S1: [-400, -10],
      "S1.p1": [-380, -200],
      "S1.p2": [-180, -20],
      S2: [20, 900],
      "S2.p1": [40, 600],
    });
    document.dispatchEvent(new window.Event("scroll"));
    runTimers();
    expect(told()).toEqual([expect.objectContaining({ id: "S2" })]);
  });

  it("does not take scrolling in a preview's box for the page's", () => {
    const { document, window, runTimers, told } = page({ "S1.p1": [0, 40] });
    document
      .getElementById("boxed")!
      .dispatchEvent(new window.Event("scroll", { bubbles: true }));
    runTimers();
    expect(told()).toEqual([]);
  });
});
