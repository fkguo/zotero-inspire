// ─────────────────────────────────────────────────────────────────────────────
// The look-up's buttons of selected citations, as the PDF reader's text
// selection popup shows them (readerIntegration) and the arXiv browser's bar
// of an HTML page's selection (CitationCards): the plugin's icon with
// "Refs. [12]" for one citation; for several, the icon, "Refs." and a small
// button per number. The pointer on a button shows INSPIRE's card of that
// reference; what the buttons do is their user's (these are their looks).
// ─────────────────────────────────────────────────────────────────────────────

/** The plugin's icon: "iN" on a dark square */
export function createLookupIcon(
  doc: Document,
  size: number = 14,
): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.style.flexShrink = "0";

  // Background
  const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", "16");
  rect.setAttribute("height", "16");
  rect.setAttribute("rx", "2");
  rect.setAttribute("fill", "#1a1a1a");
  svg.appendChild(rect);

  // Letter "i" - dot
  const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "4");
  circle.setAttribute("cy", "4");
  circle.setAttribute("r", "1.3");
  circle.setAttribute("fill", "#fff");
  svg.appendChild(circle);

  // Letter "i" - stem
  const iStem = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  iStem.setAttribute("x", "2.6");
  iStem.setAttribute("y", "6");
  iStem.setAttribute("width", "2.8");
  iStem.setAttribute("height", "6.5");
  iStem.setAttribute("rx", "0.5");
  iStem.setAttribute("fill", "#fff");
  svg.appendChild(iStem);

  // Letter "N"
  const nPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  nPath.setAttribute("d", "M7 12.5V3.5h2l3.5 6V3.5h1.8v9h-2l-3.5-6v6H7z");
  nPath.setAttribute("fill", "#3b82f6");
  svg.appendChild(nPath);

  return svg;
}

/** The button of one selected citation: the icon and "Refs. [label]" */
export function createSingleLookupButton(
  doc: Document,
  label: string,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.className = "toolbarButton zinspire-lookup-citation-btn";

  // Add icon and text
  button.appendChild(createLookupIcon(doc, 14));
  const textSpan = doc.createElement("span");
  textSpan.textContent = `Refs. [${label}]`;
  button.appendChild(textSpan);

  button.title = `Look up [${label}] in INSPIRE Refs.`;

  // Style the button
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 8px",
    fontSize: "13px", // FTR-FOCUSED-SELECTION: increased from 12px
    borderRadius: "4px",
    border: "1px solid var(--fill-quinary, #d1d1d5)",
    background: "var(--material-background, #ffffff)",
    cursor: "pointer",
    transition: "background 120ms ease-in-out",
  });

  button.addEventListener("mouseenter", () => {
    button.style.background = "var(--fill-quinary, #f0f0f0)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "var(--material-background, #ffffff)";
  });
  return button;
}

/**
 * The frame of several selected citations: the icon and "Refs.", their
 * buttons (createCompactLookupButton) to be added
 */
export function createLookupGroup(doc: Document): HTMLDivElement {
  const container = doc.createElement("div");
  container.className = "zinspire-lookup-container";
  Object.assign(container.style, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "3px",
    padding: "4px 6px",
    borderRadius: "4px",
    border: "1px solid var(--fill-quinary, #d1d1d5)",
    background: "var(--material-background, #ffffff)",
    maxWidth: "280px",
  });

  // Add plugin icon
  const icon = createLookupIcon(doc, 14);
  icon.style.marginRight = "4px";
  container.appendChild(icon);

  // Label prefix
  const prefix = doc.createElement("span");
  prefix.textContent = "Refs.";
  Object.assign(prefix.style, {
    fontSize: "12px", // FTR-FOCUSED-SELECTION: increased from 11px
    fontWeight: "500",
    color: "var(--fill-secondary, #666)",
    marginRight: "4px",
  });
  container.appendChild(prefix);
  return container;
}

/** The button of one of several selected citations: its number */
export function createCompactLookupButton(
  doc: Document,
  label: string,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.className = "zinspire-lookup-compact-btn";
  button.textContent = label;
  button.title = `Look up [${label}] in INSPIRE Refs.`;

  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "20px",
    padding: "2px 4px",
    fontSize: "11px", // FTR-FOCUSED-SELECTION: increased from 10px
    fontWeight: "500",
    borderRadius: "3px",
    border: "1px solid var(--fill-quinary, #d1d1d5)",
    background: "var(--material-background, #ffffff)",
    cursor: "pointer",
    transition: "all 100ms ease-in-out",
  });

  button.addEventListener("mouseenter", () => {
    button.style.background = "var(--accent-color, #4a90d9)";
    button.style.color = "#fff";
    button.style.borderColor = "var(--accent-color, #4a90d9)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "var(--material-background, #ffffff)";
    button.style.color = "inherit";
    button.style.borderColor = "var(--fill-quinary, #d1d1d5)";
  });
  return button;
}
