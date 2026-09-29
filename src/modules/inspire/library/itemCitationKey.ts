// ─────────────────────────────────────────────────────────────────────────────
// The citation key of a Zotero item: Zotero's citationKey field (where Better
// BibTeX keeps its keys), else a "Citation Key:" line of Extra. The main
// window's "Copy citation key" and the arXiv browser's BibTeX use it.
// ─────────────────────────────────────────────────────────────────────────────

/** The citation key of a Zotero item, or null */
export function itemCitationKey(item: Zotero.Item): string | null {
  const key = (item.getField("citationKey") as string | undefined)?.trim();
  if (key) return key;
  const extra = item.getField("extra") as string | undefined;
  return extra?.match(/^Citation\s+Key:\s*(\S+)/m)?.[1] ?? null;
}
