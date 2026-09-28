// ─────────────────────────────────────────────────────────────────────────────
// The INSPIRE recid of a Zotero item. Every reader of an item's recid goes
// through resolveItemRecid (or the library index built on recidFromFields),
// so the panel, the citation graph, the reader and the duplicate checks agree
// on which INSPIRE record an item is.
// ─────────────────────────────────────────────────────────────────────────────

/** Fields of a Zotero item that can hold its INSPIRE recid */
export interface RecidFields {
  archiveLocation?: string;
  archive?: string;
  url?: string;
  extra?: string;
}

const INSPIRE_HOSTS: ReadonlySet<string> = new Set([
  "inspirehep.net",
  "www.inspirehep.net",
]);

/** /literature/<recid>, /api/literature/<recid> or legacy /record/<recid> */
const INSPIRE_LITERATURE_PATH =
  /^\/(?:(?:api\/)?literature|record)\/(\d+)(?:\/|$)/;

/**
 * Recid from a link to an INSPIRE literature record; the host must be
 * inspirehep.net (optionally www.). Record URLs of other repositories
 * (cds.cern.ch/record/<n>, ...) and other INSPIRE collections number their own
 * records. A link with whitespace or a backslash is rejected: the URL parser
 * would drop or rewrite those characters, changing where the digits end.
 */
export function recidFromInspireLink(
  link: string,
  base?: string,
): string | null {
  if (!link || /[\s\\]/.test(link)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(link, base);
  } catch {
    return null;
  }
  if (!INSPIRE_HOSTS.has(parsed.hostname)) {
    return null;
  }
  const match = parsed.pathname.match(INSPIRE_LITERATURE_PATH);
  return match ? match[1] : null;
}

/**
 * Recid from an INSPIRE literature link written by hand or copied into a
 * field: an http(s) link or a scheme-relative one ("//host/path"). A link
 * without a host (a relative path, or a host name without a scheme) cannot be
 * attributed to INSPIRE and gives none.
 */
export function recidFromLinkText(
  text: string | null | undefined,
): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const link = text.trim();
  return recidFromInspireLink(link.startsWith("//") ? `https:${link}` : link);
}

/**
 * Archive Location holds a recid when Archive is "INSPIRE" (in any case,
 * spaces around ignored), as the plugin writes the two together; a number
 * under another Archive (a shelf mark, say) is not a recid.
 */
export function recidFromArchiveLocation(
  archiveLocation: string | undefined,
  archive: string | undefined,
): string | null {
  const value = (archiveLocation ?? "").trim();
  if (!/^\d+$/.test(value)) return null;
  return (archive ?? "").trim().toLowerCase() === "inspire" ? value : null;
}

/** Links in Extra: runs of non-space text starting with http(s):// or // */
const LINK_IN_TEXT = /(?:https?:)?\/\/\S+/gi;

/** Recid of the first INSPIRE literature link in Extra */
export function recidFromExtra(extra: string | undefined): string | null {
  for (const match of (extra ?? "").matchAll(LINK_IN_TEXT)) {
    const recid = recidFromLinkText(match[0]);
    if (recid) return recid;
  }
  return null;
}

/**
 * The recid of an item's fields: Archive Location (with Archive INSPIRE),
 * else the URL, else a link in Extra. INSPIRE is the only source of recids,
 * so where several fields hold one they are the same.
 */
export function recidFromFields(fields: RecidFields): string | null {
  return (
    recidFromArchiveLocation(fields.archiveLocation, fields.archive) ??
    recidFromLinkText(fields.url) ??
    recidFromExtra(fields.extra)
  );
}

function stringField(item: Zotero.Item, name: string): string {
  const value = item.getField(name);
  return typeof value === "string" ? value : "";
}

/** The INSPIRE recid of a Zotero item, or null */
export function resolveItemRecid(item: Zotero.Item): string | null {
  return recidFromFields({
    archiveLocation: stringField(item, "archiveLocation"),
    archive: stringField(item, "archive"),
    url: stringField(item, "url"),
    extra: stringField(item, "extra"),
  });
}
