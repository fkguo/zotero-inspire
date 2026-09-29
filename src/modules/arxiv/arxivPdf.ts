// ─────────────────────────────────────────────────────────────────────────────
// The arXiv PDF of a paper added to the library, attached to its item. The
// PDF is one request for the versioned address the arXiv API gives
// (https://arxiv.org/pdf/<id>v<N>), sent through the arXiv web scheduler
// (15 s after the previous arxiv.org request), anonymous, without following
// redirects: arXiv answers these addresses directly, and a redirect followed
// inside Zotero's download would leave the scheduler. The bytes go to a
// temporary file in Zotero's storage folder, from which Zotero's own
// importFromFile makes the attachment; the temporary folder is removed.
// The attachment's title names the version, so that a journal article's
// item does not pass an arXiv PDF off as the journal's.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../utils/locale";
import {
  ArxivFetchError,
  getArxivWebScheduler,
  type ArxivFetchErrorKind,
  type ArxivScheduler,
} from "./arxivFetch";

export type ArxivPdfFailure =
  /** arXiv answered with another status than 200 (a redirect included) */
  | "http"
  /** The answer is not a PDF */
  | "notPdf"
  /** The library does not allow files */
  | "filesNotEditable"
  /** Zotero could not store the file */
  | "save"
  | ArxivFetchErrorKind;

export type ArxivPdfResult =
  | { status: "attached"; attachment: Zotero.Item }
  | { status: "failed"; reason: ArxivPdfFailure; message: string };

/** A paper's PDF: its versioned address and version */
export interface ArxivPdfSource {
  id: string;
  version: number;
  pdfUrl?: string;
}

/**
 * The version of a PDF attachment of paper `id` downloaded from arXiv, as its
 * address names it (arxiv.org/pdf/<id>v<N>, with or without ".pdf"); null
 * when the address names none (a journal's PDF, arxiv.org/pdf/<id>.pdf)
 */
export function arxivPdfVersion(
  attachment: Zotero.Item,
  id: string,
): number | null {
  if (!attachment.isPDFAttachment?.()) return null;
  const escaped = id.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const match = String(attachment.getField?.("url") ?? "").match(
    new RegExp(
      `^https?://(?:www\\.|export\\.)?arxiv\\.org/pdf/${escaped}v(\\d+)(?:\\.pdf)?/?(?:[?#].*)?$`,
      "i",
    ),
  );
  return match ? Number(match[1]) : null;
}

interface ZoteroAttachments {
  createTemporaryStorageDirectory(): Promise<{ path: string }>;
  shouldAutoRenameFile(isLink: boolean, libraryID: number): boolean;
  isRenameAllowedForType(contentType: string, libraryID: number): boolean;
  getFileBaseNameFromItem(
    item: Zotero.Item,
    options: { attachmentTitle: string },
  ): string;
  importFromFile(options: {
    file: string;
    parentItemID: number;
    contentType: string;
    title: string;
    fileBaseName?: string;
  }): Promise<Zotero.Item>;
}

/** A download may take a while for a large PDF */
const PDF_TIMEOUT_MS = 120000;

/** The versioned PDF address of a paper, on https://arxiv.org */
export function arxivPdfUrl(source: ArxivPdfSource): string {
  const url =
    source.pdfUrl ?? `https://arxiv.org/pdf/${source.id}v${source.version}`;
  return url.replace(/^http:\/\//, "https://");
}

function startsWithPdfSignature(bytes: Uint8Array): boolean {
  // "%PDF-"
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => bytes[i] === b);
}

/** Download a paper's arXiv PDF and attach it to `item` */
export async function attachArxivPdf(
  item: Zotero.Item,
  source: ArxivPdfSource,
  options: { signal?: AbortSignal; scheduler?: ArxivScheduler } = {},
): Promise<ArxivPdfResult> {
  const fail = (reason: ArxivPdfFailure, message: string): ArxivPdfResult => ({
    status: "failed",
    reason,
    message,
  });
  const library = Zotero.Libraries.get(item.libraryID) as
    | { filesEditable?: boolean }
    | false;
  if (!library || !library.filesEditable) {
    return fail("filesNotEditable", "The library does not allow files");
  }
  const url = arxivPdfUrl(source);
  let body: ArrayBuffer | undefined;
  try {
    const response = await (
      options.scheduler ?? getArxivWebScheduler()
    ).request(url, {
      signal: options.signal,
      responseType: "arraybuffer",
      timeoutMs: PDF_TIMEOUT_MS,
    });
    if (response.status !== 200) {
      return fail("http", `arXiv answered ${response.status} for ${url}`);
    }
    body = response.body;
  } catch (err) {
    if (err instanceof ArxivFetchError) return fail(err.kind, err.message);
    return fail("network", String(err));
  }
  const bytes = new Uint8Array(body ?? new ArrayBuffer(0));
  if (!startsWithPdfSignature(bytes)) {
    return fail("notPdf", `${url} did not give a PDF`);
  }
  if (options.signal?.aborted) return fail("cancelled", "Request cancelled");

  const title = getString("arxiv-pdf-attachment-title", {
    args: { version: source.version },
  });
  // Zotero 10's attachment functions, beyond zotero-types' list
  const attachments = Zotero.Attachments as unknown as ZoteroAttachments;
  const tmpDir = (await attachments.createTemporaryStorageDirectory()).path;
  try {
    const file = PathUtils.join(
      tmpDir,
      `${source.id.replace("/", "_")}v${source.version}.pdf`,
    );
    await IOUtils.write(file, bytes);
    if (options.signal?.aborted) return fail("cancelled", "Request cancelled");
    // Named like the PDFs Zotero itself downloads, when the user has Zotero
    // rename files
    const rename =
      attachments.shouldAutoRenameFile(false, item.libraryID) &&
      attachments.isRenameAllowedForType("application/pdf", item.libraryID);
    const attachment = await attachments.importFromFile({
      file,
      parentItemID: item.id,
      contentType: "application/pdf",
      title,
      ...(rename
        ? {
            fileBaseName: attachments.getFileBaseNameFromItem(item, {
              attachmentTitle: title,
            }),
          }
        : {}),
    });
    return { status: "attached", attachment };
  } catch (err) {
    return fail("save", String(err));
  } finally {
    await IOUtils.remove(tmpDir, { recursive: true, ignoreAbsent: true });
  }
}
