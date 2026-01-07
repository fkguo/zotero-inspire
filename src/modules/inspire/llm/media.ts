export function parseDataUrl(
  input: string,
): { mimeType: string; data: string } | null {
  const src = String(input || "").trim();
  if (!src) return null;
  if (!src.startsWith("data:")) return null;
  const comma = src.indexOf(",");
  if (comma < 0) return null;

  const meta = src.slice(5, comma).trim();
  const data = src.slice(comma + 1).trim();
  if (!data) return null;

  const metaParts = meta.split(";").map((p) => p.trim());
  const mimeType = metaParts[0] || "";
  const isBase64 = metaParts.includes("base64");

  if (!mimeType || !isBase64) return null;
  return { mimeType, data };
}

export function stripDataUrlPrefix(input: string): string {
  const parsed = parseDataUrl(input);
  return parsed?.data ?? String(input || "").trim();
}

