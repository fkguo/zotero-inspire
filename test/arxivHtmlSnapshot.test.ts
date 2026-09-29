// ─────────────────────────────────────────────────────────────────────────────
// arXiv's HTML version saved as a snapshot: Zotero's importFromURL of the
// versioned page, started only in the arxiv.org scheduler's slot (15 s after
// the previous request); a paper without HTML version or a capture of
// another page leaves nothing; snapshots are recognised by their URL, the
// arXiv translator's abstract-page snapshot not among them.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/locale", () => ({
  getString: (key: string, options?: { args?: Record<string, unknown> }) =>
    key === "arxiv-html-snapshot-title"
      ? `arXiv HTML v${options?.args?.version}`
      : key,
}));

import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import {
  htmlSnapshotID,
  htmlSnapshotVersion,
  saveArxivHtmlSnapshot,
} from "../src/modules/arxiv/arxivHtmlSnapshot";
import { VirtualClock } from "./virtualClock";

const SOURCE = { id: "2609.28538", version: 2 };
const URL_V2 = "https://arxiv.org/html/2609.28538v2";

/** An attachment as Zotero has it */
function attachment(id: number, url: string, contentType = "text/html") {
  return {
    id,
    attachmentContentType: contentType,
    getField: (field: string) => (field === "url" ? url : ""),
    eraseTx: vi.fn(async () => undefined),
  };
}

let clock: VirtualClock;
let scheduler: ArxivScheduler;
let sent: { url: string; at: number }[];
let imports: { options: any; at: number }[];
let importFromURL: (options: any) => Promise<unknown>;
let filesEditable: boolean;

const item = { id: 77, libraryID: 1 } as unknown as Zotero.Item;

beforeEach(() => {
  clock = new VirtualClock();
  sent = [];
  imports = [];
  filesEditable = true;
  scheduler = new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    clock,
    transport: async (url) => {
      sent.push({ url, at: clock.now() });
      return { status: 200, text: "", header: () => null };
    },
  });
  importFromURL = async (options) => attachment(78, options.url);
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Libraries: { get: () => ({ filesEditable }) },
    Attachments: {
      importFromURL: (options: any) => {
        imports.push({ options, at: clock.now() });
        return importFromURL(options);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving arXiv's HTML version as a snapshot", () => {
  it("captures the versioned page with Zotero's importFromURL, titled with the version, in the scheduler's slot 15 s after the previous arxiv.org request", async () => {
    const listing = scheduler.request("https://arxiv.org/list/hep-ph/new");
    const saving = saveArxivHtmlSnapshot(item, SOURCE, { scheduler });
    await clock.advanceBy(14999);
    expect(imports).toHaveLength(0);
    const result = await clock.run(saving);
    await listing;

    expect(imports).toEqual([
      {
        options: {
          url: URL_V2,
          parentItemID: 77,
          title: "arXiv HTML v2",
          contentType: "text/html",
        },
        at: 15000,
      },
    ]);
    expect(result).toMatchObject({ status: "saved", attachment: { id: 78 } });
  });

  it("captures one page at a time: a second save waits for the first to end", async () => {
    let finish: () => void = () => undefined;
    importFromURL = async (options) => {
      if (imports.length === 1) {
        await new Promise<void>((resolve) => (finish = resolve));
      }
      return attachment(78 + imports.length, options.url);
    };
    const first = saveArxivHtmlSnapshot(item, SOURCE, { scheduler });
    const second = saveArxivHtmlSnapshot(
      item,
      { id: "2609.28540", version: 1 },
      { scheduler },
    );
    await clock.advanceBy(60000);
    expect(imports.map((i) => i.at)).toEqual([0]);
    finish();
    await clock.run(Promise.all([first, second]));
    expect(imports.map((i) => i.at)).toEqual([0, 75000]);
  });

  it("says arXiv has no HTML version when the page answers 404, with nothing saved", async () => {
    importFromURL = async () => {
      throw Object.assign(new Error("Invalid response 404"), { status: 404 });
    };
    const result = await clock.run(
      saveArxivHtmlSnapshot(item, SOURCE, { scheduler }),
    );
    expect(result).toMatchObject({ status: "failed", reason: "noHtml" });
  });

  it("erases a snapshot of another page than the one asked for (a load Zotero gave up on)", async () => {
    const blank = attachment(79, "about:blank");
    importFromURL = async () => blank;
    const result = await clock.run(
      saveArxivHtmlSnapshot(item, SOURCE, { scheduler }),
    );
    expect(result).toMatchObject({ status: "failed", reason: "capture" });
    expect(blank.eraseTx).toHaveBeenCalledTimes(1);
  });

  it("reports a failed capture, and a library without files before any request", async () => {
    importFromURL = async () => {
      throw new Error("Page never loaded in hidden browser");
    };
    expect(
      await clock.run(saveArxivHtmlSnapshot(item, SOURCE, { scheduler })),
    ).toMatchObject({ status: "failed", reason: "capture" });

    filesEditable = false;
    imports = [];
    expect(
      await clock.run(saveArxivHtmlSnapshot(item, SOURCE, { scheduler })),
    ).toMatchObject({ status: "failed", reason: "filesNotEditable" });
    expect(imports).toHaveLength(0);
  });
});

describe("recognising a paper's HTML snapshots", () => {
  it("takes an HTML attachment of arxiv.org/html/<id>, with or without version, and nothing else", () => {
    const version = (url: string, type?: string) =>
      htmlSnapshotVersion(
        attachment(1, url, type) as unknown as Zotero.Item,
        "2609.28538",
      );
    expect(version(URL_V2.replace("v2", "v3"))).toBe(3);
    expect(version("https://arxiv.org/html/2609.28538")).toBe(0);
    expect(version("https://arxiv.org/html/2609.28538v1/")).toBe(1);
    expect(version("http://www.arxiv.org/html/2609.28538v1")).toBe(1);
    // The arXiv translator's snapshot of the abstract page
    expect(version("https://arxiv.org/abs/2609.28538v1")).toBeNull();
    // Another paper; the PDF
    expect(version("https://arxiv.org/html/2609.285381v1")).toBeNull();
    expect(version("https://arxiv.org/html/2609.28538v1/x1.png")).toBeNull();
    expect(
      version("https://arxiv.org/html/2609.28538v1", "application/pdf"),
    ).toBeNull();
    // An old-style identifier
    expect(
      htmlSnapshotVersion(
        attachment(2, "https://arxiv.org/html/hep-ph/0101001v2") as any,
        "hep-ph/0101001",
      ),
    ).toBe(2);
  });

  it("finds the item's first snapshot of the paper, of any version or of one", () => {
    const attachments: Record<number, unknown> = {
      1: {
        getAttachments: () => [2, 3, 4],
      },
      2: attachment(2, "https://arxiv.org/abs/2609.28538v1"),
      3: attachment(3, "https://arxiv.org/html/2609.28538v1"),
      4: attachment(4, "https://arxiv.org/html/2609.28538v2"),
    };
    vi.stubGlobal("Zotero", {
      Items: { get: (id: number) => attachments[id] },
    });
    expect(htmlSnapshotID(1, "2609.28538")).toBe(3);
    expect(htmlSnapshotID(1, "2609.28538", 2)).toBe(4);
    expect(htmlSnapshotID(1, "2609.28538", 5)).toBeNull();
    expect(htmlSnapshotID(1, "2609.28540")).toBeNull();
  });
});
