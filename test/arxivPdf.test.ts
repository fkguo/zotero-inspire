// ─────────────────────────────────────────────────────────────────────────────
// The arXiv PDF of a paper added to the library: one request for the
// versioned address through the arXiv web scheduler (15 s after the previous
// arxiv.org request, redirects not followed), only a PDF becomes an
// attachment, the temporary folder is always removed.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/locale", () => ({
  getString: (key: string, options?: { args?: Record<string, unknown> }) =>
    key === "arxiv-pdf-attachment-title"
      ? `arXiv preprint PDF v${options?.args?.version}`
      : key,
}));

import {
  ArxivFetchError,
  ArxivScheduler,
  type ArxivResponse,
  type ArxivTransport,
} from "../src/modules/arxiv/arxivFetch";
import { arxivPdfUrl, attachArxivPdf } from "../src/modules/arxiv/arxivPdf";
import { VirtualClock } from "./virtualClock";

const PDF = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a,
]).buffer;
const HTML = new TextEncoder().encode("<!DOCTYPE html><html>").buffer;
const SOURCE = {
  id: "2609.28544",
  version: 2,
  pdfUrl: "https://arxiv.org/pdf/2609.28544v2",
};

let files: Map<string, Uint8Array>;
let dirs: Set<string>;
let importFromFile: ReturnType<typeof vi.fn>;
let filesEditable: boolean;
let autoRename: boolean;
let requests: { url: string; options: any }[];
let reply: () => Promise<ArxivResponse>;

function response(status: number, body?: ArrayBuffer): ArxivResponse {
  return { status, text: "", body, header: () => null };
}

const scheduler = {
  request: (url: string, options: any) => {
    requests.push({ url, options });
    return reply();
  },
} as unknown as ArxivScheduler;

const item = { id: 77, libraryID: 1 } as unknown as Zotero.Item;

beforeEach(() => {
  files = new Map();
  dirs = new Set();
  requests = [];
  filesEditable = true;
  autoRename = false;
  reply = async () => response(200, PDF);
  importFromFile = vi.fn(async (options: any) => {
    if (!files.has(options.file)) throw new Error("no file");
    return { id: 78, options };
  });
  let n = 0;
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Libraries: { get: () => ({ filesEditable }) },
    Attachments: {
      createTemporaryStorageDirectory: async () => {
        const path = `/storage/tmp-${++n}`;
        dirs.add(path);
        return { path };
      },
      shouldAutoRenameFile: () => autoRename,
      isRenameAllowedForType: (type: string) => type === "application/pdf",
      getFileBaseNameFromItem: () => "Pathak et al. - 2026 - Hyperfine",
      importFromFile,
    },
  });
  vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") });
  vi.stubGlobal("IOUtils", {
    write: async (path: string, bytes: Uint8Array) => {
      files.set(path, bytes);
    },
    remove: async (path: string) => {
      dirs.delete(path);
      for (const file of [...files.keys()]) {
        if (file.startsWith(`${path}/`)) files.delete(file);
      }
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attaching a paper's arXiv PDF", () => {
  it("asks once for the versioned PDF, as bytes, and attaches it with its version in the title", async () => {
    const result = await attachArxivPdf(item, SOURCE, { scheduler });

    expect(requests).toEqual([
      {
        url: "https://arxiv.org/pdf/2609.28544v2",
        options: {
          signal: undefined,
          responseType: "arraybuffer",
          timeoutMs: 120000,
        },
      },
    ]);
    expect(importFromFile).toHaveBeenCalledWith({
      file: "/storage/tmp-1/2609.28544v2.pdf",
      parentItemID: 77,
      contentType: "application/pdf",
      title: "arXiv preprint PDF v2",
    });
    expect(result).toMatchObject({
      status: "attached",
      attachment: { id: 78 },
    });
    // The temporary folder is gone
    expect(dirs.size).toBe(0);
    expect(files.size).toBe(0);
  });

  it("names the file as Zotero names downloaded PDFs when Zotero renames files", async () => {
    autoRename = true;
    await attachArxivPdf(item, SOURCE, { scheduler });
    expect(importFromFile.mock.calls[0][0]).toMatchObject({
      fileBaseName: "Pathak et al. - 2026 - Hyperfine",
    });
  });

  it("builds the https address of an old-style paper without the API's link", () => {
    expect(arxivPdfUrl({ id: "hep-ph/0101001", version: 1 })).toBe(
      "https://arxiv.org/pdf/hep-ph/0101001v1",
    );
    expect(
      arxivPdfUrl({ ...SOURCE, pdfUrl: "http://arxiv.org/pdf/2609.28544v2" }),
    ).toBe("https://arxiv.org/pdf/2609.28544v2");
  });

  it.each([
    ["a redirect", () => response(301), "http"],
    ["an error page", () => response(404), "http"],
    ["a page that is not a PDF", () => response(200, HTML), "notPdf"],
    ["an empty answer", () => response(200), "notPdf"],
  ])("attaches nothing for %s", async (_label, answer, reason) => {
    reply = async () => answer();
    const result = await attachArxivPdf(item, SOURCE, { scheduler });
    expect(result).toMatchObject({ status: "failed", reason });
    expect(importFromFile).not.toHaveBeenCalled();
    expect(dirs.size).toBe(0);
  });

  it("attaches nothing when the request is cancelled or refused", async () => {
    reply = async () => {
      throw new ArxivFetchError("cancelled", "Request cancelled");
    };
    expect(await attachArxivPdf(item, SOURCE, { scheduler })).toMatchObject({
      status: "failed",
      reason: "cancelled",
    });
    reply = async () => {
      throw new ArxivFetchError("unavailable", "503", 503);
    };
    expect(await attachArxivPdf(item, SOURCE, { scheduler })).toMatchObject({
      status: "failed",
      reason: "unavailable",
    });
    expect(importFromFile).not.toHaveBeenCalled();
  });

  it("attaches nothing, and removes the file, when cancelled while the file is written", async () => {
    const controller = new AbortController();
    const write = (globalThis as any).IOUtils.write;
    (globalThis as any).IOUtils.write = async (path: string, bytes: any) => {
      await write(path, bytes);
      controller.abort();
    };
    expect(
      await attachArxivPdf(item, SOURCE, {
        scheduler,
        signal: controller.signal,
      }),
    ).toMatchObject({ status: "failed", reason: "cancelled" });
    expect(importFromFile).not.toHaveBeenCalled();
    expect(dirs.size).toBe(0);
    expect(files.size).toBe(0);
  });

  it("asks nothing for an item of a library that does not allow files", async () => {
    filesEditable = false;
    expect(await attachArxivPdf(item, SOURCE, { scheduler })).toMatchObject({
      status: "failed",
      reason: "filesNotEditable",
    });
    expect(requests).toEqual([]);
  });

  it("removes the temporary folder when Zotero cannot store the file", async () => {
    importFromFile.mockRejectedValueOnce(new Error("disk full"));
    expect(await attachArxivPdf(item, SOURCE, { scheduler })).toMatchObject({
      status: "failed",
      reason: "save",
    });
    expect(dirs.size).toBe(0);
    expect(files.size).toBe(0);
  });

  it("waits its turn on arxiv.org: 15 s after the previous request, redirects not followed", async () => {
    const clock = new VirtualClock();
    const sent: { url: string; at: number; responseType?: string }[] = [];
    const transport: ArxivTransport = async (url, options) => {
      sent.push({ url, at: clock.now(), responseType: options.responseType });
      await clock.sleep(1000);
      return url.includes("/pdf/") ? response(200, PDF) : response(200);
    };
    const web = new ArxivScheduler({
      host: "arxiv.org",
      minIntervalMs: 15000,
      timeoutMs: 60000,
      transport,
      clock,
    });
    const listing = web.request("https://arxiv.org/list/hep-ph/new");
    const pdf = attachArxivPdf(item, SOURCE, { scheduler: web });
    await clock.run(Promise.all([listing, pdf]));
    expect(sent).toEqual([
      {
        url: "https://arxiv.org/list/hep-ph/new",
        at: 0,
        responseType: undefined,
      },
      {
        url: "https://arxiv.org/pdf/2609.28544v2",
        at: 16000,
        responseType: "arraybuffer",
      },
    ]);
    expect(importFromFile).toHaveBeenCalledOnce();
  });
});
