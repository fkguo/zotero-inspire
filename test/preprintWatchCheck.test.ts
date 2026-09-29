// ─────────────────────────────────────────────────────────────────────────────
// Preprint watch: finding the preprints to check, asking INSPIRE about them,
// and the cache of INSPIRE's answers (preprintWatch.json in the cache folder).
// Zotero, the cache folder and INSPIRE are fakes (preprintWatchFakes.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  prefs: new Map<string, unknown>(),
  cacheDir: "/cache",
}));
vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: mocks.fetch,
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { getCacheDir: async () => mocks.cacheDir },
}));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  // Firefox stores integer preferences as 32-bit signed integers
  setPref: (key: string, value: unknown) =>
    mocks.prefs.set(key, typeof value === "number" ? value | 0 : value),
}));

import {
  batchCheckPublicationStatus,
  beginManualCheck,
  buildCheckSummary,
  clearPreprintCache,
  findUnpublishedPreprints,
  runBackgroundCheck,
  shouldRunBackgroundCheck,
  startBackgroundCheck,
  stopBackgroundCheck,
  updateLastCheckTime,
} from "../src/modules/inspire/preprintWatchService";
import {
  CACHE_FILE,
  FakeZotero,
  abortError,
  deferred,
  inspireAnswers,
  inspireRecord,
  inspireResponse,
  publishedRecord,
  requestedArxivIds,
  unpublishedRecord,
  type InspireMetadata,
} from "./preprintWatchFakes";

let zotero: FakeZotero;
let answers: Map<string, InspireMetadata[] | number | Error>;

beforeEach(() => {
  clearPreprintCache();
  mocks.prefs.clear();
  mocks.cacheDir = "/cache";
  zotero = new FakeZotero();
  zotero.install();
  answers = new Map();
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(inspireAnswers(answers));
});

afterEach(() => {
  vi.useRealTimers();
  stopBackgroundCheck();
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

/** The arXiv IDs asked about, request by request */
const requests = () =>
  mocks.fetch.mock.calls.map(([url]) => requestedArxivIds(url as string));
const requestedIds = () => requests().flat();

/** `count` arXiv IDs from `first` on (2408.00001, 2408.00002, ...) */
function arxivIds(count: number, prefix = "2408", first = 1): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${prefix}.${String(first + i).padStart(5, "0")}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// What INSPIRE's record says (kept by the fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("reading INSPIRE's record of a preprint", () => {
  it("reads the journal publication of a published paper", async () => {
    const item = preprint("2401.00001");
    answers.set("2401.00001", [
      inspireRecord("2401.00001", 2765432, {
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
      }),
    ]);

    const results = await batchCheckPublicationStatus([item as any]);

    const url = new URL(mocks.fetch.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toBe("arxiv:2401.00001");
    expect(url.searchParams.get("size")).toBe("1");
    expect(url.searchParams.get("fields")).toBe(
      "control_number,arxiv_eprints,titles.title,first_author.full_name,first_author.last_name,collaborations.value,publication_info,dois,preprint_date,texkeys,citation_count,citation_count_without_self_citations",
    );
    expect(results).toEqual([
      {
        itemID: item.id,
        arxivId: "2401.00001",
        title: "Paper 2401.00001",
        status: "published",
        mismatches: [],
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
      inspireRecord("2401.00002", 11, {
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
      }),
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
      inspireRecord("2401.00003", 12, {
        publication_info: [
          { journal_title: "Phys.Rev.D", material: "erratum" },
        ],
      }),
    ]);

    const [result] = await batchCheckPublicationStatus([item as any]);

    expect(result.status).toBe("unpublished");
    expect(result.publicationInfo).toBeUndefined();
  });

  it("counts a record without a journal as unpublished", async () => {
    const items = [preprint("2401.00004"), preprint("2401.00005")];
    answers.set("2401.00004", [unpublishedRecord("2401.00004", 13)]);
    answers.set("2401.00005", [
      inspireRecord("2401.00005", 14, {
        // conference record only, no journal
        publication_info: [{ cnum: "C23-12-13.2" }],
      }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Asking INSPIRE and storing its answers (changed by the fix)
// ─────────────────────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 28, 1, 18);

/** A version-2 cache file with the given entries */
function storeCache(entries: object[]) {
  zotero.files.set(CACHE_FILE, { version: 2, entries });
}

function storedEntries(): Array<Record<string, any>> {
  return (zotero.files.get(CACHE_FILE) as { entries: any[] }).entries;
}

const storedEntry = (arxivId: string) =>
  storedEntries().find((entry) => entry.arxivId === arxivId);

const PUBLICATION = {
  journalTitle: "Phys. Rev. D",
  volume: "110",
  pageStart: "014001",
  year: 2025,
  recid: "9",
};

describe("the record of the item's paper", () => {
  it("takes only a record that lists the item's arXiv ID itself", async () => {
    const item = preprint("2403.00001");
    // a search hit for another paper (e.g. INSPIRE matching a similar number)
    answers.set("2403.00001", [publishedRecord("2403.00011", 81)]);

    const [result] = await batchCheckPublicationStatus([item as any]);

    expect(result.status).toBe("not_in_inspire");
  });

  it("lists a record whose title or first author differs with the reasons, not as missing from INSPIRE", async () => {
    const wrongPaper = preprint("2403.00002", "Sneaky Sneutrino Scattering");
    wrongPaper.creators = [{ firstName: "P. S.", lastName: "Bhupal Dev" }];
    const published = preprint("2403.00003", "Another paper altogether");
    answers.set("2403.00002", [unpublishedRecord("2403.00002", 82)]);
    answers.set("2403.00003", [publishedRecord("2403.00003", 83)]);

    const results = await batchCheckPublicationStatus([
      wrongPaper,
      published,
    ] as any);

    expect(results.map((r) => [r.status, r.mismatches])).toEqual([
      ["unpublished", ["title", "firstAuthor"]],
      ["published", ["title"]],
    ]);
    expect(results[0].completion).toMatchObject({
      status: "found",
      record: { recid: "82" },
      mismatches: ["title", "firstAuthor"],
      preselected: false,
    });
  });
  it("takes the record an item names by its recid as the item's paper, whatever its title", async () => {
    const named = zotero.addItem("preprint", {
      title: "A title changed by the journal",
      extra: "arXiv:2403.00009 [hep-ph]",
      archive: "INSPIRE",
      archiveLocation: "89",
    });
    // INSPIRE merged the item's record into another one
    const merged = zotero.addItem("preprint", {
      title: "A title changed by the journal",
      extra: "arXiv:2403.00010 [hep-ph]",
      archive: "INSPIRE",
      archiveLocation: "80",
    });
    answers.set("2403.00009", [publishedRecord("2403.00009", 89)]);
    answers.set("2403.00010", [publishedRecord("2403.00010", 90)]);

    const results = await batchCheckPublicationStatus([named, merged] as any);

    expect(results.map((r) => r.mismatches)).toEqual([[], ["title"]]);
  });
});

describe("an unpublished record of an item without a recid", () => {
  it("carries what writing the INSPIRE record writes, for items without a recid only", async () => {
    const plain = preprint("2403.00004");
    const withRecid = zotero.addItem("preprint", {
      title: "Paper 2403.00005",
      extra: "arXiv:2403.00005 [hep-ph]",
      archive: "INSPIRE",
      archiveLocation: "85",
    });
    const withLink = zotero.addItem("preprint", {
      title: "Paper 2403.00006",
      extra: "arXiv:2403.00006 [hep-ph]",
      url: "https://inspirehep.net/literature/86",
    });
    const published = preprint("2403.00007");
    answers.set("2403.00004", [
      inspireRecord("2403.00004", 84, {
        texkeys: ["Pathak:2024abc"],
        citation_count: 7,
        citation_count_without_self_citations: 5,
      }),
    ]);
    answers.set("2403.00005", [unpublishedRecord("2403.00005", 85)]);
    answers.set("2403.00006", [unpublishedRecord("2403.00006", 86)]);
    answers.set("2403.00007", [publishedRecord("2403.00007", 87)]);

    const results = await batchCheckPublicationStatus([
      plain,
      withRecid,
      withLink,
      published,
    ] as any);

    expect(results.map((r) => [r.status, !!r.completion])).toEqual([
      ["unpublished", true],
      ["unpublished", false],
      ["unpublished", false],
      ["published", false],
    ]);
    expect(results[0].completion).toEqual({
      itemID: plain.id,
      libraryID: 1,
      arxivId: "2403.00004",
      title: "Paper 2403.00004",
      firstAuthor: { lastName: "Pathak", firstName: "Rahul" },
      status: "found",
      record: {
        recid: "84",
        title: "Paper 2403.00004",
        firstAuthor: "Pathak, Rahul",
        texkey: "Pathak:2024abc",
        citationCount: 7,
        citationCountWithoutSelf: 5,
      },
      mismatches: [],
      preselected: true,
    });
    expect(buildCheckSummary(results).withoutRecid).toBe(1);
  });

  it("gives each item of a paper in two libraries its own entry", async () => {
    zotero.libraries.push({
      libraryID: 2,
      libraryType: "group",
      editable: true,
      name: "Group",
    });
    const mine = preprint("2403.00008");
    const group = preprint("2403.00008", "Paper 2403.00008", 2);
    answers.set("2403.00008", [unpublishedRecord("2403.00008", 88)]);

    const results = await batchCheckPublicationStatus([mine, group] as any);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(
      results.map((r) => [
        r.completion?.itemID,
        r.completion?.libraryID,
        r.completion?.record?.recid,
      ]),
    ).toEqual([
      [mine.id, 1, "88"],
      [group.id, 2, "88"],
    ]);
  });
});

describe("the four outcomes of a check", () => {
  it("tells a paper INSPIRE has no record of from an unpublished one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const items = [preprint("2404.00001"), preprint("2404.00002")];
    answers.set("2404.00001", []);
    answers.set("2404.00002", [unpublishedRecord("2404.00002", 21)]);

    const results = await batchCheckPublicationStatus(items as any);

    expect(results.map((r) => r.status)).toEqual([
      "not_in_inspire",
      "unpublished",
    ]);
    expect(storedEntries()).toEqual([
      { arxivId: "2404.00001", status: "not_in_inspire", lastChecked: NOW },
      { arxivId: "2404.00002", status: "unpublished", lastChecked: NOW },
    ]);
  });

  it("reports a failed request as an error and keeps the earlier answer", async () => {
    storeCache([
      {
        arxivId: "2404.00003",
        status: "published",
        lastChecked: NOW - 3 * DAY,
        publicationInfo: PUBLICATION,
      },
      { arxivId: "2404.00004", status: "unpublished", lastChecked: NOW - DAY },
    ]);
    const items = [
      preprint("2404.00003"),
      preprint("2404.00004"),
      preprint("2404.00005"),
    ];
    answers.set("2404.00003", 502);
    answers.set("2404.00004", 502);
    answers.set("2404.00005", 502);

    const results = await batchCheckPublicationStatus(items as any);

    expect(results.map((r) => [r.status, r.error])).toEqual([
      ["error", "INSPIRE did not answer"],
      ["error", "INSPIRE did not answer"],
      ["error", "INSPIRE did not answer"],
    ]);
    expect(zotero.files.get(CACHE_FILE)).toEqual({
      version: 2,
      entries: [
        {
          arxivId: "2404.00003",
          status: "published",
          lastChecked: NOW - 3 * DAY,
          publicationInfo: PUBLICATION,
        },
        {
          arxivId: "2404.00004",
          status: "unpublished",
          lastChecked: NOW - DAY,
        },
      ],
    });
  });

  it("treats a response without a list of records as a failure", async () => {
    const item = preprint("2404.00006");
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: "maintenance" }),
    });

    const [result] = await batchCheckPublicationStatus([item as any]);

    expect(result).toMatchObject({
      status: "error",
      error: "INSPIRE did not answer",
    });
  });
});

describe("a manual check", () => {
  it("asks INSPIRE about every preprint, even one it answered minutes ago", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    storeCache([
      { arxivId: "2405.00001", status: "unpublished", lastChecked: NOW - HOUR },
      {
        arxivId: "2405.00002",
        status: "not_in_inspire",
        lastChecked: NOW - HOUR,
      },
    ]);
    const items = [preprint("2405.00001"), preprint("2405.00002")];
    answers.set("2405.00001", [publishedRecord("2405.00001", 31)]);
    answers.set("2405.00002", [unpublishedRecord("2405.00002", 32)]);

    const first = await batchCheckPublicationStatus(items as any);
    answers.set("2405.00002", [publishedRecord("2405.00002", 32)]);
    vi.setSystemTime(NOW + 60_000);
    const second = await batchCheckPublicationStatus(items as any);

    expect(first.map((r) => r.status)).toEqual(["published", "unpublished"]);
    expect(second.map((r) => r.status)).toEqual(["published", "published"]);
    expect(requests()).toEqual([
      ["2405.00001", "2405.00002"],
      ["2405.00001", "2405.00002"],
    ]);
    expect(storedEntry("2405.00002")).toMatchObject({
      status: "published",
      lastChecked: NOW + 60_000,
    });
  });

  it("asks once about a paper that is in two libraries", async () => {
    zotero.libraries.push({
      libraryID: 2,
      libraryType: "group",
      editable: true,
      name: "Group",
    });
    const mine = preprint("2405.00003");
    const group = preprint("2405.00003", "Paper in the group", 2);
    answers.set("2405.00003", [publishedRecord("2405.00003", 33)]);

    const results = await batchCheckPublicationStatus([mine, group] as any);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(results.map((r) => [r.itemID, r.status])).toEqual([
      [mine.id, "published"],
      [group.id, "published"],
    ]);
  });

  it("asks about 50 papers per request, at most 3 requests at a time", async () => {
    const items = arxivIds(160).map((id) => preprint(id));
    const pending: Array<ReturnType<typeof deferred<Response>>> = [];
    mocks.fetch.mockImplementation(() => {
      const request = deferred<Response>();
      pending.push(request);
      return request.promise;
    });

    const run = batchCheckPublicationStatus(items as any);
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(3);
    for (let i = 0; i < 4; i++) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(i));
      pending[i].resolve(inspireResponse([]));
    }
    await run;

    expect(requests().map((ids) => ids.length)).toEqual([50, 50, 50, 10]);
    expect(new Set(requestedIds())).toEqual(new Set(arxivIds(160)));
  });

  it("counts the items answered in its progress", async () => {
    const first = arxivIds(50);
    const items = [
      ...first.map((id) => preprint(id)),
      preprint("2405.00005"),
      preprint("2405.00005", "Same paper, second item"),
      zotero.addItem("journalArticle", { journalAbbreviation: "arXiv:x" }),
    ];
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    mocks.fetch.mockImplementation((url: string) => {
      const request = deferred<Response>();
      pending.set(requestedArxivIds(url)[0], request);
      return request.promise;
    });
    const progress: Array<[number, number]> = [];

    const run = batchCheckPublicationStatus(items as any, {
      onProgress: (done, total) => progress.push([done, total]),
    });
    await vi.waitFor(() => expect(pending.size).toBe(2));
    expect(progress).toEqual([[1, 53]]);
    pending
      .get("2405.00005")!
      .resolve(inspireResponse([unpublishedRecord("2405.00005", 35)]));
    await vi.waitFor(() => expect(progress).toHaveLength(2));
    pending.get(first[0])!.resolve(inspireResponse([]));
    await run;

    expect(progress).toEqual([
      [1, 53],
      [3, 53],
      [53, 53],
    ]);
  });

  it("keeps the answers received before it was stopped", async () => {
    const start = Date.now();
    const ids = arxivIds(151, "2405");
    storeCache([
      { arxivId: ids[60], status: "unpublished", lastChecked: NOW - DAY },
    ]);
    const items = ids.map((id) => preprint(id));
    const stop = new AbortController();
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    mocks.fetch.mockImplementation(
      (url: string, options?: { signal?: AbortSignal }) => {
        const request = deferred<Response>();
        pending.set(requestedArxivIds(url)[0], request);
        options?.signal?.addEventListener("abort", () =>
          request.reject(abortError()),
        );
        return request.promise;
      },
    );

    const run = batchCheckPublicationStatus(items as any, {
      signal: stop.signal,
    });
    await vi.waitFor(() => expect(pending.size).toBe(3));
    pending
      .get(ids[0])!
      .resolve(
        inspireResponse(
          ids.slice(0, 50).map((id, i) => publishedRecord(id, 100 + i)),
        ),
      );
    await vi.waitFor(() => expect(pending.size).toBe(4));
    stop.abort();
    const results = await run;

    expect(results.map((r) => r.status)).toEqual([
      ...Array(50).fill("published"),
      ...Array(101).fill("error"),
    ]);
    expect(results[60].error).toBe("Cancelled");
    expect(storedEntries()).toHaveLength(51);
    expect(storedEntries()[0]).toEqual({
      arxivId: ids[60],
      status: "unpublished",
      lastChecked: NOW - DAY,
    });
    expect(storedEntry(ids[0])).toMatchObject({ status: "published" });
    expect(storedEntry(ids[0])!.lastChecked).toBeGreaterThanOrEqual(start);
  });
});

describe("the background check", () => {
  it("skips papers INSPIRE had no record of in the last 7 days, and asks about all others", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const entries = [
      // answered an hour ago: asked again (a record's publication and
      // identity are checked on every check)
      {
        arxivId: "2406.00001",
        status: "unpublished",
        lastChecked: NOW - HOUR,
      },
      {
        arxivId: "2406.00002",
        status: "published",
        lastChecked: NOW - HOUR,
        publicationInfo: PUBLICATION,
      },
      // no record 6 days ago: skipped
      {
        arxivId: "2406.00003",
        status: "not_in_inspire",
        lastChecked: NOW - 6 * DAY,
      },
      // no record 8 days ago, or never answered since the format changed
      {
        arxivId: "2406.00005",
        status: "not_in_inspire",
        lastChecked: NOW - 8 * DAY,
      },
      { arxivId: "2406.00006", status: "not_in_inspire", lastChecked: 0 },
    ];
    storeCache(entries);
    const items = entries.map((entry) => preprint(entry.arxivId));
    // not in the cache: asked
    items.push(preprint("2406.00007"));
    for (const id of [
      "2406.00001",
      "2406.00002",
      "2406.00005",
      "2406.00006",
      "2406.00007",
    ]) {
      answers.set(id, [unpublishedRecord(id, 40)]);
    }

    const results = await batchCheckPublicationStatus(items as any, {
      background: true,
    });

    expect(requests()).toEqual([
      ["2406.00001", "2406.00002", "2406.00005", "2406.00006", "2406.00007"],
    ]);
    expect(results.map((r) => r.status)).toEqual([
      "unpublished",
      "unpublished",
      "not_in_inspire",
      "unpublished",
      "unpublished",
      "unpublished",
    ]);
    expect(storedEntry("2406.00003")).toEqual(entries[2]);
    for (const id of [
      "2406.00001",
      "2406.00002",
      "2406.00005",
      "2406.00006",
      "2406.00007",
    ]) {
      expect(storedEntry(id)).toEqual({
        arxivId: id,
        status: "unpublished",
        lastChecked: NOW,
      });
    }
  });

  it("does not renew the time of a missing record it skips", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const item = preprint("2406.00009");
    answers.set("2406.00009", []);
    await batchCheckPublicationStatus([item as any]);

    vi.setSystemTime(NOW + 2 * DAY);
    const [result] = await batchCheckPublicationStatus([item as any], {
      background: true,
    });

    expect(result.status).toBe("not_in_inspire");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(storedEntry("2406.00009")).toEqual({
      arxivId: "2406.00009",
      status: "not_in_inspire",
      lastChecked: NOW,
    });
  });

  it("asks again when the clock was set back after an answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    storeCache([
      {
        arxivId: "2406.00008",
        status: "not_in_inspire",
        lastChecked: NOW + DAY,
      },
    ]);
    answers.set("2406.00008", [publishedRecord("2406.00008", 48)]);

    const [result] = await batchCheckPublicationStatus(
      [preprint("2406.00008")] as any,
      { background: true },
    );

    expect(result.status).toBe("published");
  });
});

describe("the background check at startup", () => {
  /** INSPIRE requests that the test answers; they fail when their signal aborts */
  function pendingRequests() {
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    mocks.fetch.mockImplementation(
      (url: string, options?: { signal?: AbortSignal }) => {
        const request = deferred<Response>();
        pending.set(requestedArxivIds(url)[0], request);
        options?.signal?.addEventListener("abort", () =>
          request.reject(abortError()),
        );
        return request.promise;
      },
    );
    return pending;
  }

  const showResults = vi.fn(async (_results: unknown) => undefined);

  beforeEach(() => {
    showResults.mockClear();
    mocks.prefs.set("preprint_watch_enabled", true);
    mocks.prefs.set("preprint_watch_auto_check", "daily");
    mocks.prefs.set("preprint_watch_last_check", 0);
  });

  it("checks every editable library, skipping recent missing records, and shows the published preprints", async () => {
    zotero.libraries.push({
      libraryID: 2,
      libraryType: "group",
      editable: true,
      name: "Group",
    });
    storeCache([
      {
        arxivId: "2406.00020",
        status: "not_in_inspire",
        lastChecked: Date.now() - HOUR,
      },
    ]);
    preprint("2406.00020");
    preprint("2406.00021", "Group paper", 2);
    answers.set("2406.00021", [publishedRecord("2406.00021", 71)]);

    await runBackgroundCheck(showResults);

    expect(requestedIds()).toEqual(["2406.00021"]);
    expect(showResults).toHaveBeenCalledTimes(1);
    expect(
      (
        showResults.mock.calls[0][0] as Array<{
          arxivId: string;
          status: string;
        }>
      ).map((r) => [r.arxivId, r.status]),
    ).toEqual([
      ["2406.00020", "not_in_inspire"],
      ["2406.00021", "published"],
    ]);
    // recorded as done for the day
    expect(shouldRunBackgroundCheck()).toBe(false);
  });

  it("sends its INSPIRE requests as background requests, after the ones a user waits for", async () => {
    preprint("2406.00023");
    answers.set("2406.00023", [unpublishedRecord("2406.00023", 73)]);
    await runBackgroundCheck(showResults);
    await batchCheckPublicationStatus([preprint("2406.00024")] as any);
    expect(mocks.fetch.mock.calls.map((call) => !!call[1]?.background)).toEqual(
      [true, false],
    );
  });

  it("shows nothing when no preprint is published and every item names its record, and records a check without preprints as done", async () => {
    zotero.addItem("preprint", {
      extra: "arXiv:2406.00022 [hep-ph]",
      title: "Paper 2406.00022",
      archive: "INSPIRE",
      archiveLocation: "72",
    });
    answers.set("2406.00022", [unpublishedRecord("2406.00022", 72)]);
    await runBackgroundCheck(showResults);
    expect(showResults).not.toHaveBeenCalled();
    expect(shouldRunBackgroundCheck()).toBe(false);

    mocks.prefs.set("preprint_watch_last_check", 0);
    zotero.items.clear();
    await runBackgroundCheck(showResults);
    expect(shouldRunBackgroundCheck()).toBe(false);
  });

  it("shows the INSPIRE records the items do not name yet, also when no preprint is published", async () => {
    preprint("2406.00026");
    answers.set("2406.00026", [unpublishedRecord("2406.00026", 76)]);

    await runBackgroundCheck(showResults);

    expect(showResults).toHaveBeenCalledTimes(1);
    expect(
      (showResults.mock.calls[0][0] as Array<{ completion?: unknown }>)[0]
        .completion,
    ).toMatchObject({ record: { recid: "76" } });
  });

  it("is not recorded as done when every request failed, and is when INSPIRE answered some", async () => {
    const ids = arxivIds(51, "2406", 100);
    for (const id of ids) preprint(id);
    for (const id of ids) answers.set(id, 503);
    await runBackgroundCheck(showResults);
    expect(shouldRunBackgroundCheck()).toBe(true);

    // the second request (the 51st paper) is answered
    answers.set(ids[50], [unpublishedRecord(ids[50], 74)]);
    await runBackgroundCheck(showResults);
    expect(shouldRunBackgroundCheck()).toBe(false);
  });

  it("does nothing when preprint watch is off or its startup check is set to never", async () => {
    preprint("2406.00023");
    mocks.prefs.set("preprint_watch_enabled", false);
    await runBackgroundCheck(showResults);
    mocks.prefs.set("preprint_watch_enabled", true);
    mocks.prefs.set("preprint_watch_auto_check", "never");
    await runBackgroundCheck(showResults);

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("is stopped by a manual check: keeps its answers, shows no dialog, and is not recorded as done", async () => {
    const pending = pendingRequests();
    const ids = arxivIds(51, "2406", 10);
    for (const id of ids) preprint(id);
    const background = runBackgroundCheck(showResults);
    await vi.waitFor(() => expect(pending.size).toBe(2));
    pending
      .get(ids[0])!
      .resolve(inspireResponse([publishedRecord(ids[0], 50)]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const endManualCheck = beginManualCheck();
    await background;

    expect(showResults).not.toHaveBeenCalled();
    expect(storedEntries()).toHaveLength(50);
    expect(storedEntry(ids[0])).toMatchObject({ status: "published" });
    expect(storedEntry(ids[50])).toBeUndefined();
    // the next start checks the papers not answered yet
    expect(shouldRunBackgroundCheck()).toBe(true);
    // and no background check starts while the manual check lasts
    expect(startBackgroundCheck()).toBeNull();
    endManualCheck();
    expect(startBackgroundCheck()).not.toBeNull();
  });

  it("does not start while a manual check is in progress", async () => {
    preprint("2406.00013");
    answers.set("2406.00013", [publishedRecord("2406.00013", 53)]);
    const endManualCheck = beginManualCheck();

    await runBackgroundCheck(showResults);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(shouldRunBackgroundCheck()).toBe(true);

    endManualCheck();
    endManualCheck(); // ending twice counts once
    await runBackgroundCheck(showResults);
    expect(showResults).toHaveBeenCalledTimes(1);
  });
});

describe("the cache file", () => {
  it("keeps the entries of a version-1 cache until INSPIRE answers them again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const version1 = {
      version: 1,
      lastFullScan: NOW - HOUR,
      lastCheck: NOW - HOUR,
      entries: [
        {
          arxivId: "2407.00001",
          itemId: 5,
          lastChecked: NOW - HOUR,
          status: "unpublished",
        },
        {
          arxivId: "2407.00002",
          itemId: 6,
          lastChecked: NOW - HOUR,
          status: "published",
          publicationInfo: PUBLICATION,
        },
        {
          arxivId: "2407.00003",
          itemId: 7,
          lastChecked: NOW - HOUR,
          status: "error",
        },
        {
          arxivId: "2407.00004",
          itemId: 8,
          lastChecked: NOW - HOUR,
          status: "unpublished",
        },
      ],
    };
    zotero.files.set(CACHE_FILE, version1);
    const items = ["2407.00001", "2407.00002", "2407.00003"].map((id) =>
      preprint(id),
    );
    answers.set("2407.00001", [publishedRecord("2407.00001", 51)]);
    answers.set("2407.00002", 502);
    answers.set("2407.00003", []);

    // Even the background check asks: version-1 times are not answer times
    const results = await batchCheckPublicationStatus(
      [items[0], items[2]] as any,
      { background: true },
    );
    // a failed request (on its own: it fails every paper it asks about)
    const failed = await batchCheckPublicationStatus([items[1]] as any, {
      background: true,
    });

    expect(requests()).toEqual([["2407.00001", "2407.00003"], ["2407.00002"]]);
    expect([...results, ...failed].map((r) => [r.arxivId, r.status])).toEqual([
      ["2407.00001", "published"],
      ["2407.00003", "not_in_inspire"],
      ["2407.00002", "error"],
    ]);
    expect(zotero.files.get(CACHE_FILE)).toEqual({
      version: 2,
      entries: [
        expect.objectContaining({
          arxivId: "2407.00001",
          status: "published",
          lastChecked: NOW,
        }),
        // failed request: the old entry stays, still counted as never checked
        {
          arxivId: "2407.00002",
          status: "published",
          lastChecked: 0,
          publicationInfo: PUBLICATION,
        },
        { arxivId: "2407.00003", status: "not_in_inspire", lastChecked: NOW },
        // not among the checked items: kept
        { arxivId: "2407.00004", status: "unpublished", lastChecked: 0 },
      ],
    });
  });

  it("leaves a cache file of an unknown format unchanged", async () => {
    const newer = { version: 3, entries: [{ id: "2407.00005", answer: "x" }] };
    zotero.files.set(CACHE_FILE, newer);
    answers.set("2407.00005", [publishedRecord("2407.00005", 55)]);

    const [result] = await batchCheckPublicationStatus([
      preprint("2407.00005"),
    ] as any);

    expect(result.status).toBe("published");
    expect(zotero.files.get(CACHE_FILE)).toEqual(newer);
  });

  it("reads the file of a cache folder chosen in Preferences, and writes answers to the file they were read with", async () => {
    storeCache([
      { arxivId: "2407.00006", status: "unpublished", lastChecked: NOW - DAY },
    ]);
    const synced = {
      version: 2,
      entries: [
        {
          arxivId: "2407.00007",
          status: "published",
          lastChecked: NOW - DAY,
          publicationInfo: PUBLICATION,
        },
      ],
    };
    zotero.files.set("/synced/preprintWatch.json", structuredClone(synced));
    const request = deferred<Response>();
    mocks.fetch.mockReturnValue(request.promise);

    const running = batchCheckPublicationStatus([
      preprint("2407.00006"),
    ] as any);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    // the user picks another cache folder while the check runs
    mocks.cacheDir = "/synced";
    request.resolve(inspireResponse([publishedRecord("2407.00006", 60)]));
    await running;

    expect(storedEntries()).toEqual([
      expect.objectContaining({ arxivId: "2407.00006", status: "published" }),
    ]);
    expect(zotero.files.get("/synced/preprintWatch.json")).toEqual(synced);

    mocks.fetch.mockImplementation(inspireAnswers(answers));
    answers.set("2407.00008", [unpublishedRecord("2407.00008", 61)]);
    await batchCheckPublicationStatus([preprint("2407.00008")] as any);

    expect(
      (zotero.files.get("/synced/preprintWatch.json") as any).entries.map(
        (entry: { arxivId: string }) => entry.arxivId,
      ),
    ).toEqual(["2407.00007", "2407.00008"]);
  });

  it("writes the file through a temporary file, so that quitting during a write cannot cut it short", async () => {
    answers.set("2407.00009", [unpublishedRecord("2407.00009", 62)]);

    await batchCheckPublicationStatus([preprint("2407.00009")] as any);

    expect(zotero.writeOptions).toEqual([
      { path: CACHE_FILE, options: { tmpPath: `${CACHE_FILE}.tmp` } },
    ]);
  });

  it("writes the file one save after the other when two checks save at the same time", async () => {
    zotero.writeDelayMs = 5;
    answers.set("2407.00010", [unpublishedRecord("2407.00010", 70)]);
    answers.set("2407.00011", [unpublishedRecord("2407.00011", 71)]);

    await Promise.all([
      batchCheckPublicationStatus([preprint("2407.00010")] as any),
      batchCheckPublicationStatus([preprint("2407.00011")] as any),
    ]);

    expect(storedEntries().map((entry) => entry.arxivId)).toEqual([
      "2407.00010",
      "2407.00011",
    ]);
  });

  it("writes the answers to disk every 100 answers during a long check", async () => {
    const items = arxivIds(150).map((id) => preprint(id));
    mocks.fetch.mockImplementation(async (url: string) =>
      inspireResponse(
        requestedArxivIds(url).map((id) => unpublishedRecord(id, 1)),
      ),
    );

    await batchCheckPublicationStatus(items as any);

    // after the second request (100 answers), and at the end
    expect(zotero.writeOptions).toHaveLength(2);
    expect(storedEntries()).toHaveLength(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Which items "check all preprints" and the background check look at
// ─────────────────────────────────────────────────────────────────────────────

describe("finding the preprints of every library", () => {
  it("scans every editable library on every check, whatever the cache holds", async () => {
    zotero.libraries.push(
      { libraryID: 2, libraryType: "group", editable: true, name: "Group" },
      {
        libraryID: 3,
        libraryType: "group",
        editable: false,
        name: "Read-only",
      },
      { libraryID: 4, libraryType: "feed", editable: false, name: "Feed" },
    );
    const cached = preprint("2409.00001");
    const neverCached = preprint("2409.00002");
    const inGroup = preprint("2409.00003", "Group paper", 2);
    preprint("2409.00004", "Read-only group paper", 3);
    zotero.addItem(
      "journalArticle",
      { extra: "arXiv:2409.00005" },
      {
        libraryID: 4,
      },
    );
    storeCache([
      { arxivId: "2409.00001", status: "unpublished", lastChecked: Date.now() },
    ]);

    const first = await findUnpublishedPreprints();
    const later = preprint("2409.00006");
    const second = await findUnpublishedPreprints();

    const ids = (items: Zotero.Item[]) => items.map((item) => item.id);
    expect(ids(first)).toEqual([cached.id, neverCached.id, inGroup.id]);
    expect(ids(second)).toEqual([
      cached.id,
      neverCached.id,
      later.id,
      inGroup.id,
    ]);
    // the list of preprints is not stored
    expect(storedEntries()).toEqual([
      expect.objectContaining({ arxivId: "2409.00001" }),
    ]);
  });

  it("loads the items of a library not shown yet in this session before reading them", async () => {
    zotero.libraries.push({
      libraryID: 2,
      libraryType: "group",
      editable: true,
      name: "Group",
    });
    const mine = preprint("2409.00007");
    const inGroup = preprint("2409.00008", "Group paper", 2);
    zotero.unloadedLibraries.add(2);

    const found = await findUnpublishedPreprints();

    expect(found.map((item) => item.id)).toEqual([mine.id, inGroup.id]);
  });

  it("scans a library of the owner's size quickly", async () => {
    // Composition of the owner's library (2026-09-28): 8,187 journal articles,
    // 36 of them arXiv-only; 882 preprints, 877 with an arXiv ID; about 700
    // items of other types; a group library with one item.
    zotero.libraries.push({
      libraryID: 2,
      libraryType: "group",
      editable: true,
      name: "Group",
    });
    zotero.addItem("computerProgram", { title: "Code" }, { libraryID: 2 });
    const arxivId = (i: number) =>
      `${15 + (i % 10)}${String(1 + (i % 12)).padStart(2, "0")}.${String(i + 1).padStart(5, "0")}`;
    for (let i = 0; i < 8187; i++) {
      const id = arxivId(i);
      zotero.addItem(
        "journalArticle",
        i < 36
          ? { extra: `arXiv:${id} [hep-ph]` }
          : {
              journalAbbreviation: "Phys. Rev. D",
              DOI: `10.1103/PhysRevD.${i}`,
              volume: "100",
              pages: String(i),
              extra: `arXiv:${id} [hep-ph]`,
            },
      );
    }
    for (let i = 0; i < 882; i++) {
      const id = arxivId(8187 + i);
      zotero.addItem(
        "preprint",
        i < 877
          ? {
              extra: `arXiv:${id} [hep-ph]`,
              url: `https://arxiv.org/abs/${id}`,
              DOI: `10.48550/arXiv.${id}`,
            }
          : { title: "No arXiv ID" },
      );
    }
    for (let i = 0; i < 700; i++) {
      zotero.addItem("presentation", { title: `Talk ${i}` });
    }

    const start = performance.now();
    const found = await findUnpublishedPreprints();
    const elapsed = performance.now() - start;
    console.log(
      `Scanned ${zotero.items.size} items in ${elapsed.toFixed(0)} ms: ${found.length} preprints`,
    );

    expect(found).toHaveLength(36 + 877);
    expect(zotero.loadedItemCount).toBe(8187 + 882);
    // Generous bound (parallel test files load the machine); the scan itself
    // takes about 100 ms here
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("the daily background check", () => {
  it("runs at most once a day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mocks.prefs.set("preprint_watch_auto_check", "daily");
    mocks.prefs.set("preprint_watch_last_check", 0);

    expect(shouldRunBackgroundCheck()).toBe(true);
    updateLastCheckTime();
    vi.setSystemTime(NOW + 23 * HOUR);
    expect(shouldRunBackgroundCheck()).toBe(false);
    vi.setSystemTime(NOW + 25 * HOUR);
    expect(shouldRunBackgroundCheck()).toBe(true);
  });

  it("runs after a time an earlier version stored in milliseconds", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mocks.prefs.set("preprint_watch_auto_check", "daily");
    // what Firefox kept of Date.now() one hour ago
    mocks.prefs.set("preprint_watch_last_check", (NOW - HOUR) | 0);

    expect(shouldRunBackgroundCheck()).toBe(true);
  });

  it("runs on every startup in the startup mode, and never in the never mode", () => {
    mocks.prefs.set("preprint_watch_last_check", Math.round(Date.now() / 1000));
    mocks.prefs.set("preprint_watch_auto_check", "startup");
    expect(shouldRunBackgroundCheck()).toBe(true);
    mocks.prefs.set("preprint_watch_auto_check", "never");
    expect(shouldRunBackgroundCheck()).toBe(false);
  });
});
