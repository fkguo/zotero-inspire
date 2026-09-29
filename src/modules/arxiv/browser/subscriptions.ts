// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions of the arXiv browser: named sets of categories (or whole
// archives) with the listing sections to show. They are kept in the plugin's
// preferences as JSON. Categories are stored under their canonical names
// (math.MP is kept as math-ph, whose pages arXiv shows), in the user's order,
// which is also the order of the categories in the merged listing.
// ─────────────────────────────────────────────────────────────────────────────

import { getPref, setPref } from "../../../utils/prefs";
import {
  ARXIV_ARCHIVES,
  ARXIV_CATEGORIES,
  arxivCategory,
} from "../arxivCategories";
import { LISTING_SECTIONS, type ListingSection } from "../listingTypes";

export interface ArxivSubscription {
  /** Key of the subscription; never shown */
  id: string;
  name: string;
  /**
   * Canonical category names and whole archives (e.g. "math"), in the order
   * the user chose
   */
  categories: string[];
  /** Which sections of the listings are shown */
  sections: Record<ListingSection, boolean>;
}

/** The sections a new subscription shows */
export const DEFAULT_SECTIONS: Readonly<Record<ListingSection, boolean>> = {
  new: true,
  cross: true,
  replace: false,
};

/** Archives with several categories, which can be subscribed to as a whole */
const WHOLE_ARCHIVES: ReadonlySet<string> = new Set(
  ARXIV_ARCHIVES.filter(
    (archive) =>
      ARXIV_CATEGORIES.filter((category) => category.archive === archive.id)
        .length > 1,
  ).map((archive) => archive.id),
);

/** Whether `name` is an archive subscribed to as a whole (math, cs, …) */
export function isWholeArchive(name: string): boolean {
  return WHOLE_ARCHIVES.has(name);
}

/**
 * The archives whose page lists a category: its own and those of its
 * aliases (the math page lists math-ph, whose alias math.MP is in math)
 */
export function archivesListing(category: string): string[] {
  const entry = arxivCategory(category);
  if (!entry) return [];
  return [
    entry.archive,
    ...entry.aliases.map((alias) => arxivCategory(alias)?.archive),
  ].filter((archive): archive is string => Boolean(archive));
}

/**
 * The categories of a subscription in stored form: aliases become their
 * canonical names, unknown names and repeats are dropped, and categories
 * listed on the page of an archive subscribed to as a whole are dropped. The
 * order is kept.
 */
export function normalizeCategories(items: readonly string[]): string[] {
  const names: string[] = [];
  for (const item of items) {
    const name = isWholeArchive(item) ? item : arxivCategory(item)?.canonical;
    if (name && !names.includes(name)) names.push(name);
  }
  const archives = new Set(names.filter(isWholeArchive));
  return names.filter(
    (name) =>
      isWholeArchive(name) ||
      !archivesListing(name).some((archive) => archives.has(archive)),
  );
}

/** The sections a subscription shows, as a set */
export function openSections(
  subscription: ArxivSubscription,
): Set<ListingSection> {
  return new Set(
    LISTING_SECTIONS.filter((section) => subscription.sections[section]),
  );
}

/** The saved subscriptions, in the order the user made them */
export function loadSubscriptions(): ArxivSubscription[] {
  try {
    const stored = JSON.parse(String(getPref("arxiv_subscriptions") || "[]"));
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function saveSubscriptions(
  subscriptions: readonly ArxivSubscription[],
): void {
  setPref("arxiv_subscriptions", JSON.stringify(subscriptions));
}

/** A key for a new subscription; it carries the time it was made */
export function newSubscriptionId(): string {
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** When a subscription was made (ms), from its key; undefined if not told */
export function subscriptionCreatedMs(id: string): number | undefined {
  const match = /^sub-([0-9a-z]+)-/.exec(id);
  return match ? parseInt(match[1], 36) : undefined;
}

/**
 * The subscription the window starts with: the default one from the
 * settings, else the first one
 */
export function defaultSubscription(
  subscriptions: readonly ArxivSubscription[],
): ArxivSubscription | undefined {
  const id = getPref("arxiv_browser_default_subscription");
  return (
    subscriptions.find((subscription) => subscription.id === id) ??
    subscriptions[0]
  );
}
