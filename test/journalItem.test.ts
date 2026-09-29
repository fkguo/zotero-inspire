// ─────────────────────────────────────────────────────────────────────────────
// The journal version of an arXiv paper (path C of adding an arXiv paper):
// Zotero's own DOI lookup gives the data without saving; the data are checked
// against the arXiv paper (DOI, title, first author) before any item exists;
// the item keeps the lookup's type and fields and gets the arXiv line.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => prefs.get(key),
  setPref: () => undefined,
}));

import {
  createItemFromJournalVersion,
  journalDOI,
  lookUpJournalVersion,
} from "../src/modules/arxiv/journalItem";
import type { ArxivApiEntry } from "../src/modules/arxiv/arxivApi";
import { FakeNewItem, installFakeNewItems } from "./fakeNewItem";

const ENTRY: ArxivApiEntry = {
  id: "2502.04458",
  version: 2,
  title:
    "Precise determination of the properties of $X(3872)$ and of its isovector partner $W_{c1}$",
  abstract: "An abstract.",
  authors: ["Zhen-Hua Zhang", "Teng Ji", "Xiang-Kun Dong"],
  published: "2025-02-06T18:00:00Z",
  updated: "2025-05-01T10:00:00Z",
  doi: "10.1016/j.scib.2025.06.012",
  primaryCategory: "hep-ph",
  categories: ["hep-ph", "hep-ex"],
};

/** What Zotero's DOI lookup gives for the paper's DOI */
function journalData(overrides: Record<string, unknown> = {}) {
  return {
    itemType: "journalArticle",
    title:
      "Precise determination of the properties of X(3872) and of its isovector partner W c1",
    creators: [
      { firstName: "Zhen-Hua", lastName: "Zhang", creatorType: "author" },
      { firstName: "Teng", lastName: "Ji" },
    ],
    publicationTitle: "Science Bulletin",
    volume: "70",
    pages: "2345-2350",
    date: "2025-07",
    DOI: "10.1016/j.scib.2025.06.012",
    extra: "Publisher: Elsevier",
    libraryCatalog: "DOI.org (Crossref)",
    tags: ["Exotic hadrons", { tag: "X(3872)" }],
    attachments: [],
    notes: [],
    ...overrides,
  };
}

let searches: { identifier?: unknown; options?: any }[];
let automaticTags: boolean;
let answer: () => Promise<any[]>;
let translators: unknown[];

beforeEach(() => {
  prefs.clear();
  searches = [];
  automaticTags = true;
  translators = [{ label: "DOI Content Negotiation" }];
  answer = async () => [journalData()];
  class Search {
    private record: { identifier?: unknown; options?: any } = {};
    constructor() {
      searches.push(this.record);
    }
    setIdentifier(identifier: unknown) {
      this.record.identifier = identifier;
    }
    async getTranslators() {
      return translators;
    }
    setTranslator() {}
    async translate(options: any) {
      this.record.options = options;
      return answer();
    }
  }
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Translate: { Search },
    Prefs: {
      get: (name: string) =>
        name === "automaticTags" ? automaticTags : undefined,
    },
    Date: { dateToISO: () => "2026-09-29T00:00:00Z" },
  });
  installFakeNewItems();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looking up the journal version of an arXiv paper", () => {
  it("asks Zotero's DOI lookup for the data only, and accepts the paper's own data", async () => {
    const result = await lookUpJournalVersion(
      ENTRY,
      "10.1016/j.scib.2025.06.012",
    );
    expect(result.status).toBe("same");
    expect(searches).toEqual([
      {
        identifier: { DOI: "10.1016/j.scib.2025.06.012" },
        options: { libraryID: false, saveAttachments: false },
      },
    ]);
    // Nothing is saved while looking up
    expect(FakeNewItem.created).toEqual([]);
  });

  it("rejects the data of another paper under the DOI the authors gave", async () => {
    // A mistyped DOI: the lookup answers with the paper that has that DOI
    answer = async () => [
      journalData({
        title: "Sneaky Sneutrino Scattering at LZ",
        creators: [{ firstName: "Bhupal", lastName: "Dev" }],
      }),
    ];
    const result = await lookUpJournalVersion(ENTRY, ENTRY.doi!);
    expect(result).toMatchObject({
      status: "different",
      reasons: ["title", "firstAuthor"],
    });
  });

  it("compares only DOI and title when arXiv gives a collaboration as the author", async () => {
    // arXiv:1808.08242: "CMS Collaboration" on arXiv, A. M. Sirunyan first in
    // the journal
    answer = async () => [
      journalData({ creators: [{ firstName: "A. M.", lastName: "Sirunyan" }] }),
    ];
    const collaboration = { ...ENTRY, authors: ["CMS Collaboration"] };
    expect((await lookUpJournalVersion(collaboration, ENTRY.doi!)).status).toBe(
      "same",
    );
    answer = async () => [
      journalData({
        title: "Sneaky Sneutrino Scattering at LZ",
        creators: [{ firstName: "A. M.", lastName: "Sirunyan" }],
      }),
    ];
    expect(await lookUpJournalVersion(collaboration, ENTRY.doi!)).toMatchObject(
      { status: "different", reasons: ["title"] },
    );
  });

  it("rejects data under another DOI", async () => {
    answer = async () => [journalData({ DOI: "10.1016/j.scib.2025.06.099" })];
    expect(await lookUpJournalVersion(ENTRY, ENTRY.doi!)).toMatchObject({
      status: "different",
      reasons: ["doi"],
    });
  });

  it("compares DOIs without case and doi.org prefixes", async () => {
    answer = async () => [
      journalData({ DOI: "https://doi.org/10.1016/J.SCIB.2025.06.012" }),
    ];
    expect((await lookUpJournalVersion(ENTRY, ENTRY.doi!)).status).toBe("same");
  });

  it("reports a DOI the lookup finds nothing for", async () => {
    translators = [];
    expect(await lookUpJournalVersion(ENTRY, ENTRY.doi!)).toEqual({
      status: "notFound",
    });
    translators = [{}];
    answer = async () => [];
    expect(await lookUpJournalVersion(ENTRY, ENTRY.doi!)).toEqual({
      status: "notFound",
    });
    answer = async () => {
      throw new Error("No items returned from any translator");
    };
    expect(await lookUpJournalVersion(ENTRY, ENTRY.doi!)).toEqual({
      status: "notFound",
    });
  });

  it("takes the first DOI when the authors gave several", () => {
    expect(
      journalDOI({
        ...ENTRY,
        doi: "10.1103/PhysRevD.1.1 10.1103/PhysRevD.1.2",
      }),
    ).toBe("10.1103/PhysRevD.1.1");
    expect(journalDOI({ ...ENTRY, doi: undefined })).toBeUndefined();
  });
});

describe("an item from the journal version", () => {
  const TARGET = {
    libraryID: 2,
    collectionIDs: [5],
    tags: ["to-read"],
    note: "<p>n</p>",
  };

  it("keeps the lookup's type and fields and adds the arXiv line", async () => {
    const item = (await createItemFromJournalVersion(
      journalData(),
      ENTRY,
      TARGET,
    )) as unknown as FakeNewItem;

    expect(item.itemType).toBe("journalArticle");
    expect(item.fields).toEqual({
      title:
        "Precise determination of the properties of X(3872) and of its isovector partner W c1",
      publicationTitle: "Science Bulletin",
      volume: "70",
      pages: "2345-2350",
      date: "2025-07",
      DOI: "10.1016/j.scib.2025.06.012",
      extra: "arXiv:2502.04458 [hep-ph]\nPublisher: Elsevier",
      libraryCatalog: "DOI.org (Crossref)",
    });
    expect(item.creators).toEqual([
      { firstName: "Zhen-Hua", lastName: "Zhang", creatorType: "author" },
      { firstName: "Teng", lastName: "Ji", creatorType: "author" },
    ]);
    // The lookup's tags automatic (as Zotero saves them), the user's manual
    expect(item.tagData).toEqual([
      { tag: "Exotic hadrons", type: 1 },
      { tag: "X(3872)", type: 1 },
    ]);
    expect(item).toMatchObject({
      libraryID: 2,
      collections: [5],
      tags: ["to-read"],
      saves: [{ skipSelect: true }],
      marksAtSave: [["_zinspireCreatedByPlugin"]],
    });
    const note = FakeNewItem.created.find((i) => i.itemType === "note");
    expect(note).toMatchObject({ noteText: "<p>n</p>", parentID: item.id });
  });

  it("leaves the lookup's tags out when Zotero's automatic tags option is off", async () => {
    automaticTags = false;
    const item = (await createItemFromJournalVersion(
      journalData(),
      ENTRY,
      TARGET,
    )) as unknown as FakeNewItem;
    expect(item.tagData).toEqual([]);
    expect(item.tags).toEqual(["to-read"]);
  });

  it("keeps the lookup's notes as child notes", async () => {
    const item = (await createItemFromJournalVersion(
      journalData({ notes: ["<p>Version 2</p>", { note: "<p>Erratum</p>" }] }),
      ENTRY,
      TARGET,
    )) as unknown as FakeNewItem;
    const notes = FakeNewItem.created
      .filter((i) => i.itemType === "note")
      .map((note) => [note.noteText, note.parentID, note.libraryID]);
    expect(notes).toEqual([
      ["<p>n</p>", item.id, 2],
      ["<p>Version 2</p>", item.id, 2],
      ["<p>Erratum</p>", item.id, 2],
    ]);
  });

  it("gets the primary category tag when category tags are on", async () => {
    prefs.set("arxiv_tag_enable", true);
    const item = (await createItemFromJournalVersion(
      journalData(),
      { ...ENTRY, id: "1009.0388", primaryCategory: "math.AG" },
      TARGET,
    )) as unknown as FakeNewItem;
    expect(item.fields.extra).toContain("arXiv:1009.0388 [math.AG]");
    expect(item.tags).toEqual(["to-read", "math.AG"]);
  });

  it("keeps a conference paper a conference paper", async () => {
    const item = (await createItemFromJournalVersion(
      journalData({
        itemType: "conferencePaper",
        publicationTitle: undefined,
        proceedingsTitle: "Proceedings",
        extra: undefined,
      }),
      ENTRY,
      TARGET,
    )) as unknown as FakeNewItem;
    expect(item.itemType).toBe("conferencePaper");
    expect(item.fields.extra).toBe("arXiv:2502.04458 [hep-ph]");
  });
});
