import MarkdownIt = require("markdown-it");

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

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
