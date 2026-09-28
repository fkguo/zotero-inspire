// ─────────────────────────────────────────────────────────────────────────────
// Preprint watch: finding the preprints to check, asking INSPIRE about them,
// and the cache of INSPIRE's answers (preprintWatch.json in the cache folder).
// Zotero, the cache folder and INSPIRE are fakes (preprintWatchFakes.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  prefs: new Map<string, unknown>(),
}));
vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: mocks.fetch,
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { getCacheDir: async () => "/cache" },
}));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  // Firefox stores integer preferences as 32-bit signed integers
  setPref: (key: string, value: unknown) =>
    mocks.prefs.set(key, typeof value === "number" ? value | 0 : value),
}));

import {
  batchCheckPublicationStatus,
  clearPreprintCache,
  findUnpublishedPreprints,
} from "../src/modules/inspire/preprintWatchService";
import {
  FakeZotero,
  inspireAnswers,
  publishedRecord,
  requestedArxivId,
  unpublishedRecord,
  type InspireMetadata,
} from "./preprintWatchFakes";

let zotero: FakeZotero;
let answers: Map<string, InspireMetadata[] | number | Error>;

beforeEach(() => {
  clearPreprintCache();
  mocks.prefs.clear();
  zotero = new FakeZotero();
  zotero.install();
  answers = new Map();
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(inspireAnswers(answers));
});

afterEach(() => {
  // A TypeError caught and logged by the plugin would let a test pass without
  // running the code it is about
  const logged = (Zotero.debug as ReturnType<typeof vi.fn>).mock.calls.map(
    ([text]) => String(text),
  );
  expect(
    logged.filter((text) => /TypeError|ReferenceError/.test(text)),
  ).toEqual([]);
});

function preprint(arxivId: string, title = `Paper ${arxivId}`, libraryID = 1) {
  return zotero.addItem(
    "preprint",
    { extra: `arXiv:${arxivId} [hep-ph]`, title },
    { libraryID },
  );
}

const requestedIds = () =>
  mocks.fetch.mock.calls.map(([url]) => requestedArxivId(url as string));

// ─────────────────────────────────────────────────────────────────────────────
// What INSPIRE's record says (kept by the fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("reading INSPIRE's record of a preprint", () => {
  it("reads the journal publication of a published paper", async () => {
    const item = preprint("2401.00001", "Paper A");
    answers.set("2401.00001", [
      {
        control_number: 2765432,
        arxiv_eprints: [{ value: "2401.00001" }],
        // free-text entry first, structured journal entry second
        publication_info: [
          { pubinfo_freetext: "Phys. Rev. D 110 (2025) 014001" },
          {
            journal_title: "Phys.Rev.D",
            journal_volume: "110",
            artid: "014001",
            year: 2025,
          },
        ],
        dois: [
          { value: "10.48550/arXiv.2401.00001" },
          { value: "10.1103/PhysRevD.110.014001" },
        ],
        preprint_date: "2024-01-02",
      },
    ]);

    const results = await batchCheckPublicationStatus([item as any]);

    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://inspirehep.net/api/literature?q=eprint:2401.00001&fields=control_number,publication_info,dois,preprint_date",
    );
    expect(results).toEqual([
      {
        itemID: item.id,
        arxivId: "2401.00001",
        title: "Paper A",
        status: "published",
        publicationInfo: {
          journalTitle: "Phys. Rev. D",
          volume: "110",
          pageStart: "014001",
          year: 2025,
          doi: "10.1103/PhysRevD.110.014001",
          recid: "2765432",
          preprintDate: "2024-01-02",
        },
      },
    ]);
  });

  it("takes the first page as the page and skips an erratum", async () => {
    const item = preprint("2401.00002");
    answers.set("2401.00002", [
      {
        control_number: 11,
        publication_info: [
          {
            journal_title: "Phys.Lett.B",
            material: "erratum",
            page_start: "9",
          },
          {
            journal_title: "Phys.Lett.B",
            journal_volume: "850",
            page_start: "138500",
            page_end: "138510",
            year: 2024,
          },
        ],
      },
    ]);

    const [result] = await batchCheckPublicationStatus([item as any]);

    expect(result.status).toBe("published");
    expect(result.publicationInfo).toMatchObject({
      journalTitle: "Phys. Lett. B",
      volume: "850",
      pageStart: "138500",
      year: 2024,
      recid: "11",
    });
    expect(result.publicationInfo?.doi).toBeUndefined();
  });

  it("does not count an erratum alone as the publication", async () => {
    const item = preprint("2401.00003");
    answers.set("2401.00003", [
      {
        control_number: 12,
        publication_info: [
          { journal_title: "Phys.Rev.D", material: "erratum" },
        ],
      },
    ]);

    const [result] = await batchCheckPublicationStatus([item as any]);

    expect(result.status).toBe("unpublished");
    expect(result.publicationInfo).toBeUndefined();
  });

  it("counts a record without a journal as unpublished", async () => {
    const items = [preprint("2401.00004"), preprint("2401.00005")];
    answers.set("2401.00004", [unpublishedRecord("2401.00004", 13)]);
    answers.set("2401.00005", [
      {
        control_number: 14,
        // conference record only, no journal
        publication_info: [{ cnum: "C23-12-13.2" }],
      },
    ]);

    const results = await batchCheckPublicationStatus(items as any);

    expect(results.map((r) => r.status)).toEqual([
      "unpublished",
      "unpublished",
    ]);
  });

  it("reports an item whose arXiv ID cannot be read, without asking INSPIRE", async () => {
    const item = zotero.addItem("journalArticle", {
      journalAbbreviation: "arXiv:not-an-id",
      title: "Broken",
    });

    const results = await batchCheckPublicationStatus([item as any]);

    expect(results).toEqual([
      {
        itemID: item.id,
        arxivId: "",
        title: "Broken",
        status: "error",
        error: "Could not extract arXiv ID",
      },
    ]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("returns the results in the order of the items", async () => {
    const items = [
      preprint("2401.00006"),
      preprint("2401.00007"),
      preprint("2401.00008"),
      preprint("2401.00009"),
    ];
    answers.set("2401.00006", [unpublishedRecord("2401.00006", 1)]);
    answers.set("2401.00007", [publishedRecord("2401.00007", 2)]);
    answers.set("2401.00008", [unpublishedRecord("2401.00008", 3)]);
    answers.set("2401.00009", [publishedRecord("2401.00009", 4)]);

    const results = await batchCheckPublicationStatus(items as any);

    expect(results.map((r) => [r.itemID, r.status])).toEqual([
      [items[0].id, "unpublished"],
      [items[1].id, "published"],
      [items[2].id, "unpublished"],
      [items[3].id, "published"],
    ]);
    expect(new Set(requestedIds())).toEqual(
      new Set(["2401.00006", "2401.00007", "2401.00008", "2401.00009"]),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Which items are checked (kept by the fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("finding the preprints of a collection", () => {
  it("takes the collection's unpublished arXiv preprints", async () => {
    const plain = preprint("2402.00001");
    const legacy = zotero.addItem("journalArticle", {
      journalAbbreviation: "arXiv:2402.00002 [hep-th]",
    });
    const published = zotero.addItem("journalArticle", {
      journalAbbreviation: "Phys. Rev. D",
      DOI: "10.1103/PhysRevD.110.1",
      volume: "110",
      pages: "1",
      extra: "arXiv:2402.00003",
    });
    const noArxiv = zotero.addItem("preprint", { title: "No arXiv ID" });
    const book = zotero.addItem("book", { extra: "arXiv:2402.00004" });
    const trashed = zotero.addItem(
      "preprint",
      { extra: "arXiv:2402.00005" },
      { deleted: true },
    );
    preprint("2402.00006"); // in the library, not in the collection
    zotero.addCollection(7, [plain, legacy, published, noArxiv, book, trashed]);

    const found = await findUnpublishedPreprints(1, 7);

    expect(found.map((item) => item.id)).toEqual([plain.id, legacy.id]);
  });
});
