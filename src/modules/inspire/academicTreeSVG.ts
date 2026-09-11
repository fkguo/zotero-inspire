const NS = "http://www.w3.org/2000/svg";

/** Resolve theme styles for portable, standalone SVG export. */
export function serializeAcademicSVG(
  doc: Document,
  element: SVGSVGElement,
  full: boolean,
  width: number,
  height: number,
) {
  const clone = element.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (full) clone.querySelector("g")?.removeAttribute("transform");
  const colors: Record<string, string> = {
    "--color-accent": "#0060df",
    "--fill-primary": "#1e293b",
    "--fill-secondary": "#64748b",
    "--fill-quaternary": "#cbd5e1",
    "--material-background": "#ffffff",
  };
  for (const el of [
    clone,
    ...Array.from(clone.querySelectorAll("*")),
  ] as Element[]) {
    el.removeAttribute("tabindex");
    for (const attribute of [...el.attributes]) {
      if (attribute.value.includes("color-mix("))
        el.setAttribute(attribute.name, "#ebf2fc");
      else if (attribute.value.includes("var("))
        el.setAttribute(
          attribute.name,
          attribute.value.replace(
            /var\((--[\w-]+),[^)]+\)/g,
            (_, key: string) => colors[key] || "#64748b",
          ),
        );
    }
  }
  const background = doc.createElementNS(NS, "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#fff");
  clone.prepend(background);
  return { svg: new XMLSerializer().serializeToString(clone), width, height };
}
