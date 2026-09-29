// ─────────────────────────────────────────────────────────────────────────────
// arXiv's HTML version of a paper, saved as a snapshot attachment of its item
// at the user's request (one paper at a time, never in batch). Zotero's own
// importFromURL loads the versioned page https://arxiv.org/html/<id>v<N> in
// its hidden browser and captures it with SingleFile, images and styles
// included; the attachment is titled "arXiv HTML v<N>". The capture takes a
// place in the arxiv.org web scheduler's chain like one request: it starts
// 15 s after the previous arxiv.org request, and nothing else (another
// capture included) goes to arxiv.org while it runs. The plugin cannot pace
// the page's own images and styles, which the hidden browser loads.
// A paper without an HTML version (arXiv answers 404) or a failed capture
// leaves nothing: Zotero removes what it had written, and a snapshot of
// another page than the one asked for (a load Zotero gave up on) is erased.
// Snapshots saved so are recognised by their URL, arxiv.org/html/<id>[v<N>];
// the abstract-page snapshot of Zotero's arXiv translator (arxiv.org/abs/…)
// is not one of them.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../utils/locale";
import { firstAttachmentID } from "../inspire/library/localPdf";
import {
  ArxivFetchError,
  getArxivWebScheduler,
  type ArxivFetchErrorKind,
  type ArxivScheduler,
} from "./arxivFetch";

export type HtmlSnapshotFailure =
  /** arXiv has no HTML version of the paper (404) */
  | "noHtml"
  /** The library does not allow files */
  | "filesNotEditable"
  /** The page could not be loaded or captured */
  | "capture"
  | ArxivFetchErrorKind;

export type HtmlSnapshotResult =
  | { status: "saved"; attachment: Zotero.Item }
  | { status: "failed"; reason: HtmlSnapshotFailure; message: string };

/** A paper's HTML version: its identifier and version */
export interface HtmlSnapshotSource {
  id: string;
  version: number;
}

interface ZoteroAttachments {
  importFromURL(options: {
    url: string;
    parentItemID: number;
    title: string;
    contentType: string;
  }): Promise<Zotero.Item>;
}

/** The versioned address of a paper's HTML version */
export function arxivHtmlUrl(source: HtmlSnapshotSource): string {
  return `https://arxiv.org/html/${source.id}v${source.version}`;
}

/**
 * The paper's HTML-version addresses, with or without version (and a
 * trailing slash)
 */
function htmlUrlPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `^https?://(?:www\\.)?arxiv\\.org/html/${escaped}(?:v(\\d+))?/?(?:[?#].*)?$`,
    "i",
  );
}

/**
 * The version of an attachment that is an HTML snapshot of arXiv's HTML
 * version of paper `id`: 0 when its address has none, null when it is not
 * such a snapshot
 */
export function htmlSnapshotVersion(
  attachment: Zotero.Item,
  id: string,
): number | null {
  if (attachment.attachmentContentType !== "text/html") return null;
  const url = String(attachment.getField?.("url") ?? "");
  const match = url.match(htmlUrlPattern(id));
  return match ? Number(match[1] ?? 0) : null;
}

/**
 * The ID of the item's first HTML snapshot of paper `id` (at `version`, when
 * given), or null
 */
export function htmlSnapshotID(
  itemID: number,
  id: string,
  version?: number,
): number | null {
  return firstAttachmentID(itemID, (attachment) => {
    const saved = htmlSnapshotVersion(attachment, id);
    return saved !== null && (version === undefined || saved === version);
  });
}

/**
 * Save arXiv's HTML version of a paper, at `source.version`, as a snapshot
 * attachment of `item`
 */
export async function saveArxivHtmlSnapshot(
  item: Zotero.Item,
  source: HtmlSnapshotSource,
  options: { signal?: AbortSignal; scheduler?: ArxivScheduler } = {},
): Promise<HtmlSnapshotResult> {
  const fail = (
    reason: HtmlSnapshotFailure,
    message: string,
  ): HtmlSnapshotResult => ({ status: "failed", reason, message });
  const library = Zotero.Libraries.get(item.libraryID) as
    | { filesEditable?: boolean }
    | false;
  if (!library || !library.filesEditable) {
    return fail("filesNotEditable", "The library does not allow files");
  }
  const url = arxivHtmlUrl(source);
  const title = getString("arxiv-html-snapshot-title", {
    args: { version: source.version },
  });
  // Zotero 10's attachment functions, beyond zotero-types' list
  const attachments = Zotero.Attachments as unknown as ZoteroAttachments;
  try {
    const attachment = await (options.scheduler ?? getArxivWebScheduler()).run(
      url,
      // The content type spares Zotero's request for it
      () =>
        attachments.importFromURL({
          url,
          parentItemID: item.id,
          title,
          contentType: "text/html",
        }),
      { signal: options.signal },
    );
    // Zotero's hidden browser goes on after a load it gave up on (it
    // captures about:blank then): only the page asked for is kept
    if (htmlSnapshotVersion(attachment, source.id) !== source.version) {
      const saved = String(attachment.getField?.("url") ?? "");
      await attachment.eraseTx();
      return fail(
        "capture",
        `Zotero captured ${saved || "no page"}, not ${url}`,
      );
    }
    return { status: "saved", attachment };
  } catch (err) {
    if (err instanceof ArxivFetchError) return fail(err.kind, err.message);
    // Zotero.HTTP.UnexpectedStatusException of the hidden browser's load
    if ((err as { status?: number } | null)?.status === 404) {
      return fail("noHtml", `arXiv has no HTML version at ${url}`);
    }
    return fail("capture", String(err));
  }
}
