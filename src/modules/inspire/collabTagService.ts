// ─────────────────────────────────────────────────────────────────────────────
// Collaboration Tag Service (FTR-COLLAB-TAGS)
// ─────────────────────────────────────────────────────────────────────────────
//
// Service for automatically adding Zotero tags based on INSPIRE collaboration
// information. Supports flexible tag format templates and batch operations.
// ─────────────────────────────────────────────────────────────────────────────

import { getPref } from "../../utils/prefs";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pattern to remove from collaboration names (Collaboration, Group, Team, etc.)
 */
export const COLLAB_SUFFIX_PATTERN =
  /\s+(Collaboration|Collab\.?|Group|Team|Consortium|Experiment)$/i;

/**
 * Default tag format template
 */
export const DEFAULT_TAG_TEMPLATE = "{name}";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of batch tag operation
 */
export interface CollabTagResult {
  /** Number of tags added */
  added: number;
  /** Number of tags updated (old template replaced with new) */
  updated: number;
  /** Number of items skipped (no collaboration info or already tagged) */
  skipped: number;
  /** Number of errors encountered */
  errors: number;
}

/**
 * Progress callback for batch operations
 */
export type CollabTagProgressCallback = (
  current: number,
  total: number,
) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract short name from full collaboration name.
 *
 * @example
 * extractCollabName("ATLAS Collaboration") // "ATLAS"
 * extractCollabName("Belle II") // "Belle II"
 * extractCollabName("CMS Collab.") // "CMS"
 * extractCollabName("LHCb Group") // "LHCb"
 *
 * @param fullName - Full collaboration name from INSPIRE
 * @returns Short collaboration name
 */
export function extractCollabName(fullName: string): string {
  if (!fullName) return "";

  // Remove Collaboration/Collab./Group/Team etc. suffix
  const cleaned = fullName.replace(COLLAB_SUFFIX_PATTERN, "").trim();

  return cleaned || fullName;
}

/**
 * Format tag name using the configured template.
 *
 * @example
 * // With template "{name}": "ATLAS"
 * // With template "#collab/{name}": "#collab/ATLAS"
 * // With template "collab:{name}": "collab:ATLAS"
 *
 * @param collabName - Full collaboration name from INSPIRE
 * @returns Formatted tag name
 */
export function formatCollabTag(collabName: string): string {
  const template =
    (getPref("collab_tag_template") as string) || DEFAULT_TAG_TEMPLATE;
  const shortName = extractCollabName(collabName);

  if (!shortName) return "";

  return template.replace("{name}", shortName);
}

/**
 * Check if collaboration tagging is enabled.
 */
export function isCollabTagEnabled(): boolean {
  return getPref("collab_tag_enable") as boolean;
}

/**
 * Check if auto-tagging on update/import is enabled.
 */
export function isCollabTagAutoEnabled(): boolean {
  return (
    (getPref("collab_tag_enable") as boolean) &&
    (getPref("collab_tag_auto") as boolean)
  );
}

/**
 * Get the current tag format template.
 */
export function getCollabTagTemplate(): string {
  return (getPref("collab_tag_template") as string) || DEFAULT_TAG_TEMPLATE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find existing collaboration tag for a given collaboration name.
 * Searches item's tags for any that contain the short collaboration name.
 *
 * @param item - Zotero item to search
 * @param collabShortName - Short collaboration name (e.g., "ATLAS")
 * @returns Existing tag name if found, null otherwise
 */
function findExistingCollabTag(
  item: Zotero.Item,
  collabShortName: string,
): string | null {
  if (!collabShortName) return null;

  const tags = item.getTags();
  // Look for tags that contain the collaboration short name
  // This handles various template formats: "{name}", "#exp/{name}", "collab:{name}", etc.
  for (const tag of tags) {
    if (tag.tag.includes(collabShortName)) {
      return tag.tag;
    }
  }
  return null;
}

/**
 * Add collaboration tags to a single Zotero item.
 * If an old template tag exists for the same collaboration, it will be updated
 * to the new template format (old tag removed, new tag added).
 *
 * @param item - Zotero item to add tags to
 * @param collaborations - Array of collaboration names from INSPIRE
 * @param save - Whether to save the item after adding tags (default: true)
 * @returns Object with counts of tags added and updated
 */
export async function addCollabTagsToItem(
  item: Zotero.Item,
  collaborations: string[],
  save: boolean = true,
): Promise<{ added: number; updated: number }> {
  if (!collaborations || collaborations.length === 0) {
    return { added: 0, updated: 0 };
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const collab of collaborations) {
    const newTagName = formatCollabTag(collab);
    const shortName = extractCollabName(collab);

    if (!newTagName || !shortName) continue;

    // Check if the new tag already exists
    if (item.hasTag(newTagName)) {
      continue; // Already has the correct tag
    }

    // Check if there's an existing tag with a different template
    const existingTag = findExistingCollabTag(item, shortName);

    if (existingTag && existingTag !== newTagName) {
      // Update: remove old tag, add new tag
      item.removeTag(existingTag);
      item.addTag(newTagName);
      updatedCount++;
    } else if (!existingTag) {
      // Add new tag
      item.addTag(newTagName);
      addedCount++;
    }
  }

  if ((addedCount > 0 || updatedCount > 0) && save) {
    await item.saveTx();
  }

  return { added: addedCount, updated: updatedCount };
}

/**
 * Extract collaboration info from item's Extra field.
 *
 * @param item - Zotero item
 * @returns Array of collaboration names, or empty array if none found
 */
export function extractCollaborationsFromExtra(item: Zotero.Item): string[] {
  const extra = item.getField("extra") as string;
  if (!extra) return [];

  // Match "tex.collaboration: ATLAS, CMS, LHCb" format
  const match = extra.match(/^tex\.collaboration:\s*(.+)$/m);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batch add collaboration tags to multiple items.
 * Uses each item's Extra field to find collaboration info.
 * If template has changed, old tags will be updated to the new format.
 *
 * @param items - Array of Zotero items
 * @param progressCallback - Optional callback for progress updates
 * @returns Result with counts of added, updated, skipped, and errors
 */
export async function batchAddCollabTags(
  items: Zotero.Item[],
  progressCallback?: CollabTagProgressCallback,
): Promise<CollabTagResult> {
  const result: CollabTagResult = {
    added: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    progressCallback?.(i + 1, items.length);

    try {
      const collaborations = extractCollaborationsFromExtra(item);

      if (collaborations.length === 0) {
        result.skipped++;
        continue;
      }

      const { added, updated } = await addCollabTagsToItem(
        item,
        collaborations,
      );

      if (added > 0 || updated > 0) {
        result.added += added;
        result.updated += updated;
      } else {
        // All tags already exist with correct template
        result.skipped++;
      }
    } catch (e) {
      result.errors++;
      ztoolkit.log(`Error adding collab tags to item ${item.id}:`, e);
    }
  }

  return result;
}
