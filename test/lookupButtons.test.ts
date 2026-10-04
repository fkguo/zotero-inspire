// ─────────────────────────────────────────────────────────────────────────────
// The look-up's buttons of selected citations, shared by the PDF reader's
// selection popup and the arXiv browser's bar: "Refs. [n]" with the plugin's
// icon for one citation; the icon, "Refs." and a number button each for
// several; their look when the pointer is on them.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  createCompactLookupButton,
  createLookupGroup,
  createSingleLookupButton,
} from "../src/modules/inspire/pdfAnnotate/lookupButtons";

const doc = () => new JSDOM("").window.document;

describe("look-up buttons of selected citations", () => {
  it("shows one citation as the icon and Refs. [n], lighter while pointed at", () => {
    const document = doc();
    const button = createSingleLookupButton(document, "12");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent).toBe("Refs. [12]");
    expect(button.title).toBe("Look up [12] in INSPIRE Refs.");
    const resting = button.style.background;
    button.dispatchEvent(new document.defaultView!.MouseEvent("mouseenter"));
    expect(button.style.background).not.toBe(resting);
    button.dispatchEvent(new document.defaultView!.MouseEvent("mouseleave"));
    expect(button.style.background).toBe(resting);
  });

  it("shows several as the icon, Refs. and a number each, a number in the accent colour while pointed at", () => {
    const document = doc();
    const group = createLookupGroup(document);
    for (const label of ["12", "13"]) {
      group.append(createCompactLookupButton(document, label));
    }
    expect(group.firstElementChild!.localName).toBe("svg");
    expect(group.textContent).toBe("Refs.1213");
    const [first] = [...group.querySelectorAll("button")];
    expect(first.title).toBe("Look up [12] in INSPIRE Refs.");
    first.dispatchEvent(new document.defaultView!.MouseEvent("mouseenter"));
    expect(first.style.color).toBe("rgb(255, 255, 255)");
    first.dispatchEvent(new document.defaultView!.MouseEvent("mouseleave"));
    expect(first.style.color).toBe("inherit");
  });
});
