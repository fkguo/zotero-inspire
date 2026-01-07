export function normalizeHtmlSupSubToLatex(text: string): string {
  const src = String(text ?? "");
  if (!src) return "";
  const lower = src.toLowerCase();
  if (!lower.includes("<sup>") && !lower.includes("<sub>")) return src;

  return src
    .replace(/<sup>([^<]*)<\/sup>/gi, (_match, content) => {
      const value = String(content ?? "").trim();
      if (!value) return "";
      return `$^{${value}}$`;
    })
    .replace(/<sub>([^<]*)<\/sub>/gi, (_match, content) => {
      const value = String(content ?? "").trim();
      if (!value) return "";
      return `$_{${value}}$`;
    });
}

