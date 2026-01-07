import { config } from "../../../package.json";
import { cleanMathTitle } from "../../utils/mathTitle";
import { getPref } from "../../utils/prefs";

declare const Zotero: any;
declare const Services: any;

type RenderMode = "unicode" | "katex";

interface KaTeXModule {
  render: (latex: string, element: HTMLElement, options?: KaTeXOptions) => void;
  renderToString: (latex: string, options?: KaTeXOptions) => string;
}

interface KaTeXOptions {
  displayMode?: boolean;
  throwOnError?: boolean;
  errorColor?: string;
  trust?: boolean;
  output?: "html" | "mathml" | "htmlAndMathml";
  macros?: Record<string, string>;
}

interface AutoRenderOptions {
  delimiters?: Array<{ left: string; right: string; display: boolean }>;
  ignoredTags?: string[];
  ignoredClasses?: string[];
  throwOnError?: boolean;
  errorColor?: string;
  trust?: boolean;
  macros?: Record<string, string>;
}

let katexModule: KaTeXModule | null = null;
let renderMathInElement: ((el: HTMLElement, opts?: AutoRenderOptions) => void) | null =
  null;
let katexLoadPromisesByWindow = new WeakMap<Window, Promise<boolean>>();

/**
 * Custom macros for KaTeX to support additional LaTeX commands.
 * Common commands from physics/HEP papers that may not be natively supported.
 */
const CUSTOM_MACROS: Record<string, string> = {
  // Text mode commands
  "\\mbox": "\\text{#1}",
  "\\hbox": "\\text{#1}",
  "\\vbox": "\\text{#1}",
  // Common physics notation
  "\\GeV": "\\text{GeV}",
  "\\TeV": "\\text{TeV}",
  "\\MeV": "\\text{MeV}",
  "\\keV": "\\text{keV}",
  "\\eV": "\\text{eV}",
  // Spacing commands
  "\\negmedspace": "\\!",
  "\\negthickspace": "\\!\\!",
  // Common abbreviations
  "\\eg": "\\text{e.g.}",
  "\\ie": "\\text{i.e.}",
  "\\cf": "\\text{cf.}",
  "\\vs": "\\text{vs.}",
  "\\etal": "\\text{et al.}",
  // Math operators that might be missing
  "\\Tr": "\\operatorname{Tr}",
  "\\tr": "\\operatorname{tr}",
  "\\diag": "\\operatorname{diag}",
  "\\sgn": "\\operatorname{sgn}",
  "\\Re": "\\operatorname{Re}",
  "\\Im": "\\operatorname{Im}",
};

/**
 * Preprocess LaTeX text to convert unsupported environments to KaTeX-compatible ones.
 *
 * Converts:
 * - \begin{eqnarray*}...\end{eqnarray*} → \[\begin{aligned}...\end{aligned}\]
 * - \begin{eqnarray}...\end{eqnarray} → \[\begin{aligned}...\end{aligned}\]
 *
 * Also fixes alignment markers:
 * - &=& → &=  (eqnarray uses 3 columns, aligned uses 2)
 * - &<& → &<
 * - &>& → &>
 * - && → &
 *
 * @param text - The LaTeX text to preprocess
 * @returns The preprocessed text with eqnarray converted to aligned
 */
function preprocessLatexEnvironments(text: string): string {
  // Pattern matches \begin{eqnarray} or \begin{eqnarray*}
  return text.replace(
    /\\begin\{eqnarray\*?\}([\s\S]*?)\\end\{eqnarray\*?\}/g,
    (_match, content: string) => {
      // Convert 3-column eqnarray alignment to 2-column aligned format
      const fixed = content
        // &=& or & = & → &= (with optional spacing)
        .replace(/\s*&\s*=\s*&\s*/g, " &= ")
        // &<& or & < & → &<
        .replace(/\s*&\s*<\s*&\s*/g, " &< ")
        // &>& or & > & → &>
        .replace(/\s*&\s*>\s*&\s*/g, " &> ")
        // &\approx&, &\pm&, etc. → &\approx, &\pm
        .replace(/\s*&\s*(\\[a-zA-Z]+)\s*&\s*/g, " &$1 ")
        // Generic && → & (fallback for other operators)
        .replace(/\s*&\s*&\s*/g, " & ");

      return `\\[\\begin{aligned}${fixed}\\end{aligned}\\]`;
    },
  );
}

/**
 * Detect whether a string contains LaTeX math delimiters.
 * Supports: $...$, $$...$$, \(...\), \[...\], \begin{eqnarray}, \begin{align}, \begin{equation}
 */
export function containsLatexMath(text: string): boolean {
  if (!text) return false;
  return /\$[^\$]+\$|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\\begin\{(eqnarray|align|equation)/.test(
    text,
  );
}

/**
 * Get current render mode from preferences.
 */
export function getRenderMode(): RenderMode {
  const mode = getPref("latex_render_mode") || "unicode";
  return mode === "katex" ? "katex" : "unicode";
}

function ensureKatexStyle(doc: Document): void {
  try {
    const mainWindow = Zotero.getMainWindow?.();
    const docs = [
      doc,
      ...(mainWindow?.document && mainWindow.document !== doc
        ? [mainWindow.document]
        : []),
    ].filter(Boolean) as Document[];

    for (const targetDoc of docs) {
      // Check if already loaded in target document
      if (targetDoc.querySelector('link[href*="katex.min.css"]')) {
        continue;
      }

      // For XUL documents without <head>, append to documentElement
      const container = targetDoc.head || targetDoc.documentElement;
      if (!container) {
        Zotero.debug(
          `[${config.addonName}] ensureKatexStyle: no container for styles`,
        );
        continue;
      }

      const link = targetDoc.createElement("link");
      link.rel = "stylesheet";
      link.href = `chrome://${config.addonRef}/content/katex/katex.min.css`;
      container.appendChild(link);

      // Dark mode compatibility and text selection for KaTeX
      const darkModeStyle = targetDoc.createElement("style");
      darkModeStyle.textContent = `
      .katex { color: inherit; user-select: text; -webkit-user-select: text; }
      .katex * { user-select: text; -webkit-user-select: text; }
      .katex .mord, .katex .mbin, .katex .mrel,
      .katex .mopen, .katex .mclose, .katex .mpunct { color: inherit; }
      .zinspire-abstract-tooltip, .zinspire-preview-card__abstract {
        user-select: text;
        -webkit-user-select: text;
        cursor: text;
      }
    `;
      container.appendChild(darkModeStyle);
    }

    Zotero.debug(`[${config.addonName}] ensureKatexStyle: CSS loaded`);
  } catch (err) {
    Zotero.debug(`[${config.addonName}] ensureKatexStyle error: ${err}`);
  }
}

function getTargetWindow(doc?: Document | null): Window | null {
  const w =
    (doc?.defaultView as unknown as Window | null) || Zotero.getMainWindow?.();
  return (w as any) || null;
}

async function ensureKatexLoaded(doc?: Document | null): Promise<boolean> {
  const win = getTargetWindow(doc);
  if (!win) return false;

  if ((win as any).katex && (win as any).renderMathInElement) {
    katexModule = (win as any).katex;
    renderMathInElement = (win as any).renderMathInElement;
    return true;
  }

  const existing = katexLoadPromisesByWindow.get(win);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const katexUrl = `chrome://${config.addonRef}/content/katex/katex.min.js`;
      const autoRenderUrl = `chrome://${config.addonRef}/content/katex/contrib/auto-render.min.js`;

      Services.scriptloader.loadSubScript(katexUrl, win);
      Services.scriptloader.loadSubScript(autoRenderUrl, win);

      const k = (win as any).katex as KaTeXModule | undefined;
      const r = (win as any).renderMathInElement as
        | ((el: HTMLElement, opts?: AutoRenderOptions) => void)
        | undefined;

      if (!k || !r) {
        throw new Error("KaTeX module missing after load");
      }

      katexModule = k;
      renderMathInElement = r;
      Zotero.debug(`[${config.addonName}] KaTeX loaded successfully`);
      return true;
    } catch (err) {
      Zotero.debug(`[${config.addonName}] Failed to load KaTeX: ${err}`);
      return false;
    }
  })();

  katexLoadPromisesByWindow.set(win, promise);
  const ok = await promise;
  if (!ok) {
    // Allow retry after failures.
    katexLoadPromisesByWindow.delete(win);
  }
  return ok;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function processUnicodeFallback(text: string): string {
  let processed = cleanMathTitle(text ?? "");
  processed = processed
    .replace(/<sup>([^<]+)<\/sup>/g, "^$1")
    .replace(/<sub>([^<]+)<\/sub>/g, "_$1");
  return processed;
}

/**
 * Render text (possibly with LaTeX) into a container element.
 */
export async function renderMathContent(
  text: string,
  container: HTMLElement,
  forceMode?: RenderMode,
): Promise<void> {
  if (!container) return;

  const mode = forceMode ?? getRenderMode();
  const safeText = text ?? "";

  if (mode === "unicode") {
    container.textContent = processUnicodeFallback(safeText);
    return;
  }

  // KaTeX mode: check for LaTeX delimiters
  const hasLatex = containsLatexMath(safeText);

  if (!hasLatex) {
    // No LaTeX found, use Unicode fallback
    container.textContent = processUnicodeFallback(safeText);
    return;
  }

  // Try to load KaTeX
  const loaded = await ensureKatexLoaded(container.ownerDocument);

  const win = getTargetWindow(container.ownerDocument);
  const renderer = (win as any)?.renderMathInElement as
    | ((el: HTMLElement, opts?: AutoRenderOptions) => void)
    | undefined;
  if (!loaded || !renderer) {
    // KaTeX not available, fall back to Unicode
    container.textContent = processUnicodeFallback(safeText);
    return;
  }

  // Wrap entire KaTeX rendering in try-catch for safety
  try {
    // Load KaTeX CSS
    ensureKatexStyle(container.ownerDocument);

    // Preprocess LaTeX environments (eqnarray* → aligned)
    const processedText = preprocessLatexEnvironments(safeText);

    // Set text content first
    container.textContent = processedText;

    // Render LaTeX with KaTeX
    renderer(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      throwOnError: false,
      errorColor: "#cc0000",
      trust: false,
      macros: CUSTOM_MACROS,
    });

    // Safety check: if KaTeX emptied the container, restore original text
    if (!container.textContent && !container.innerHTML) {
      container.textContent = safeText;
    }
  } catch (err) {
    Zotero.debug(`[${config.addonName}] KaTeX render error: ${err}`);
    // Restore original text on any error
    container.textContent = safeText;
  }
}

/**
 * Render LaTeX math delimiters inside an existing HTML container.
 *
 * Unlike `renderMathContent()`, this function preserves existing HTML structure
 * (e.g., Markdown-rendered HTML) and only transforms text nodes containing math.
 */
export async function renderLatexInElement(
  container: HTMLElement,
  forceMode?: RenderMode,
): Promise<void> {
  if (!container) return;
  const mode = forceMode ?? getRenderMode();
  if (mode !== "katex") {
    return;
  }

  const loaded = await ensureKatexLoaded(container.ownerDocument);
  if (!loaded) {
    return;
  }

  try {
    ensureKatexStyle(container.ownerDocument);
    const win = getTargetWindow(container.ownerDocument);
    const renderer = (win as any)?.renderMathInElement as
      | ((el: HTMLElement, opts?: AutoRenderOptions) => void)
      | undefined;
    if (!renderer) return;
    renderer(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      throwOnError: false,
      errorColor: "#cc0000",
      trust: false,
      macros: CUSTOM_MACROS,
    });
  } catch (err) {
    Zotero.debug(`[${config.addonName}] renderLatexInElement error: ${err}`);
  }
}

/**
 * Render a single LaTeX expression to an HTML string.
 */
export async function renderLatexToString(
  latex: string,
  displayMode = false,
): Promise<string> {
  const mode = getRenderMode();
  const safeLatex = latex ?? "";

  if (mode === "unicode") {
    return escapeHtml(cleanMathTitle(safeLatex));
  }

  const win = Zotero.getMainWindow?.();
  const loaded = await ensureKatexLoaded(win?.document);
  const km = (win as any)?.katex as KaTeXModule | undefined;
  if (!loaded || !km) {
    return escapeHtml(cleanMathTitle(safeLatex));
  }

  try {
    return km.renderToString(safeLatex, {
      displayMode,
      throwOnError: false,
      trust: false,
      output: "html",
      macros: CUSTOM_MACROS,
    });
  } catch (err) {
    Zotero.debug(`[${config.addonName}] renderToString failed: ${err}`);
    return escapeHtml(safeLatex);
  }
}

/**
 * Render text for Markdown export/copy.
 * KaTeX mode keeps the original $...$; Unicode mode converts to readable text.
 */
export function renderMarkdownMath(
  text: string,
  forceMode?: RenderMode,
): string {
  const mode = forceMode ?? getRenderMode();
  const safeText = text ?? "";

  if (mode === "katex") {
    return safeText;
  }

  let processed = processUnicodeFallback(safeText).replace(
    /<br\s*\/?>/gi,
    "\n",
  );

  // Strip any remaining HTML tags to keep Markdown clean
  processed = processed.replace(/<\/?[^>]+>/g, "");
  return processed;
}

export function resetKatexState(): void {
  katexModule = null;
  renderMathInElement = null;
  katexLoadPromisesByWindow = new WeakMap<Window, Promise<boolean>>();
}

/**
 * Handle preference change for render mode.
 */
export function onRenderModeChange(): void {
  resetKatexState();
  Zotero.debug(`[${config.addonName}] Render mode changed to: ${getRenderMode()}`);
  const mainWindow = Zotero.getMainWindow?.();
  if (mainWindow) {
    const tooltip = mainWindow.document.querySelector(
      ".zinspire-abstract-tooltip",
    ) as HTMLElement | null;
    const preview = mainWindow.document.querySelector(
      ".zinspire-preview-card",
    ) as HTMLElement | null;
    if (tooltip) {
      tooltip.style.display = "none";
    }
    if (preview) {
      preview.style.display = "none";
    }
  }
}

export type { RenderMode };
