import MarkdownIt = require("markdown-it");

function installMathSupport(md: MarkdownIt): void {
  const escapeHtml = (s: string) => md.utils.escapeHtml(String(s ?? ""));

  // Inline math: $...$
  md.inline.ruler.before("escape", "zinspire_math_inline", (state, silent) => {
    const start = state.pos;
    const src = state.src;
    if (src.charCodeAt(start) !== 0x24 /* $ */) return false;

    // Avoid treating the second "$" of "$$...$$" as inline math start.
    if (start > 0 && src.charCodeAt(start - 1) === 0x24 /* $ */) return false;

    // Avoid $$...$$ here (handled by block rule)
    if (src.charCodeAt(start + 1) === 0x24) return false;

    // Find a closing $ that is not escaped
    let pos = start + 1;
    while (pos < src.length) {
      const next = src.indexOf("$", pos);
      if (next < 0) return false;
      if (src.charCodeAt(next - 1) !== 0x5c /* \\ */) {
        const content = src.slice(start + 1, next);
        // Avoid matching empty/$ $ and common currency-like patterns
        if (!content || !content.trim()) return false;
        if (silent) return true;

        const token = state.push("zinspire_math_inline", "span", 0);
        token.content = content;
        state.pos = next + 1;
        return true;
      }
      pos = next + 1;
    }

    return false;
  });

  md.renderer.rules.zinspire_math_inline = (tokens, idx) => {
    const latex = tokens[idx]?.content ?? "";
    // Keep delimiters in one text node so KaTeX auto-render can detect them.
    return `<span class="zinspire-math-inline">$${escapeHtml(latex)}$</span>`;
  };

  // Block math: $$ ... $$ (on its own line)
  md.block.ruler.before(
    "fence",
    "zinspire_math_block",
    (state, startLine, endLine, silent) => {
      const startPos = state.bMarks[startLine] + state.tShift[startLine];
      const maxPos = state.eMarks[startLine];
      if (startPos + 2 > maxPos) return false;
      if (state.src.slice(startPos, startPos + 2) !== "$$") return false;

      const firstLineRaw = state.src.slice(startPos, maxPos);
      const firstLine = firstLineRaw.trim();

      // Support single-line display math: $$ ... $$
      if (firstLine !== "$$") {
        if (!firstLine.startsWith("$$")) return false;
        const close = firstLine.indexOf("$$", 2);
        if (close < 0 || close !== firstLine.length - 2) return false;
        const content = firstLine.slice(2, close).trim();
        if (!content) return false;
        if (silent) return true;

        state.line = startLine + 1;
        const token = state.push("zinspire_math_block", "div", 0);
        token.block = true;
        token.content = content;
        token.map = [startLine, state.line];
        return true;
      }

      let nextLine = startLine + 1;
      let found = false;
      let content = "";

      while (nextLine < endLine) {
        const pos = state.bMarks[nextLine] + state.tShift[nextLine];
        const max = state.eMarks[nextLine];
        const line = state.src.slice(pos, max);
        if (line.trim() === "$$") {
          found = true;
          break;
        }
        content += line + "\n";
        nextLine++;
      }

      if (!found) return false;
      if (silent) return true;

      state.line = nextLine + 1;
      const token = state.push("zinspire_math_block", "div", 0);
      token.block = true;
      token.content = content.replace(/\s+$/g, "");
      token.map = [startLine, state.line];
      return true;
    },
  );

  md.renderer.rules.zinspire_math_block = (tokens, idx) => {
    const latex = tokens[idx]?.content ?? "";
    // Keep delimiters in one text node so KaTeX auto-render can detect them.
    return `<div class="zinspire-math-block">$$\n${escapeHtml(
      latex,
    )}\n$$</div>\n`;
  };
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  // Zotero dialogs can be XHTML documents; ensure void tags are XHTML-safe
  // (e.g. <br />) so `innerHTML` doesn't throw in XML mode.
  xhtmlOut: true,
});

// Must be installed after MarkdownIt is created.
installMathSupport(md);

// Allow zotero:// links while still blocking dangerous schemes.
md.validateLink = (url: string) => {
  const u = String(url || "").trim().toLowerCase();
  if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("mailto:")) {
    return true;
  }
  if (u.startsWith("zotero://")) {
    return true;
  }
  return false;
};

export function markdownToSafeHtml(markdown: string): string {
  const src = String(markdown ?? "");
  return md.render(src);
}
