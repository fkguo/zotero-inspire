// ─────────────────────────────────────────────────────────────────────────────
// The arXiv categories one can browse today (arxivCategories.json, generated
// from arXiv's taxonomy by scripts/generate-arxiv-archives.mjs): the groups,
// archives and categories with their names, and the alias pairs. The two
// names of a pair list the same papers (math.MP and math-ph); arXiv's pages
// use the canonical one.
// ─────────────────────────────────────────────────────────────────────────────

import { archives, categories, groups } from "./arxivCategories.json";

export interface ArxivGroup {
  id: string;
  name: string;
}

export interface ArxivArchive {
  id: string;
  name: string;
  group: string;
}

export interface ArxivCategory {
  id: string;
  name: string;
  archive: string;
  group: string;
  /** The name arXiv's pages use (the category itself unless it is an alias) */
  canonical: string;
  /** The other name of an alias pair */
  aliases: string[];
}

export const ARXIV_GROUPS: readonly ArxivGroup[] = groups;
export const ARXIV_ARCHIVES: readonly ArxivArchive[] = archives;
export const ARXIV_CATEGORIES: readonly ArxivCategory[] = categories;

const categoryById: ReadonlyMap<string, ArxivCategory> = new Map(
  ARXIV_CATEGORIES.map((category) => [category.id, category]),
);

export function arxivCategory(id: string): ArxivCategory | undefined {
  return categoryById.get(id);
}

/**
 * The listing pages to fetch for the items of a subscription (categories and
 * whole archives): an alias becomes its canonical category, a name given
 * twice is fetched once, the order is kept. A whole archive (math) stays an
 * archive: its own page is fetched.
 */
export function subscriptionPageSpecs(items: readonly string[]): string[] {
  const specs: string[] = [];
  for (const item of items) {
    const spec = categoryById.get(item)?.canonical ?? item;
    if (!specs.includes(spec)) specs.push(spec);
  }
  return specs;
}
