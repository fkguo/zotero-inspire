// ─────────────────────────────────────────────────────────────────────────────
// A library item from a paper's arXiv data (path B of adding an arXiv paper):
// the fields as the plugin writes an arXiv preprint it imports from INSPIRE,
// the whole author list with arXiv's own split where the listing shows it,
// and only fields the item's type has.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prefs: new Map<string, unknown>() }));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: () => undefined,
}));

import {
  arxivCreators,
  createItemFromArxiv,
} from "../src/modules/arxiv/arxivItem";
import type { ArxivApiEntry } from "../src/modules/arxiv/arxivApi";
import { setInspireMeta } from "../src/modules/inspire/itemUpdater";
import { FakeNewItem, installFakeNewItems } from "./fakeNewItem";

/** An API answer shaped like the one for 2609.28544 (names and dates made up) */
const ENTRY: ArxivApiEntry = {
  id: "2609.28544",
  version: 2,
  title: "Hyperfine Structure of $B$ and $D$ Mesons in a QCD-Inspired\n  Potential Model",
  abstract:
    "We study the hyperfine\n  splitting of heavy-light mesons.\n  A second line.",
  authors: ["Rahul Pathak", "Rohit Di Vora", "Akash Kumar Singh"],
  published: "2026-09-24T17:59:01Z",
  updated: "2026-09-27T10:00:00Z",
  pdfUrl: "https://arxiv.org/pdf/2609.28544v2",
  primaryCategory: "hep-ph",
  categories: ["hep-ph", "hep-lat"],
};

const LISTING = [
  { display: "Rahul Pathak", family: "Pathak", given: "Rahul" },
  { display: "Rohit Di Vora", family: "Di Vora", given: "Rohit" },
  { display: "Akash Kumar Singh", family: "Singh", given: "Akash Kumar" },
];

const TARGET = { libraryID: 1, collectionIDs: [4], tags: ["to-read"] };

beforeEach(() => {
  mocks.prefs.clear();
  mocks.prefs.set("keep_preprint_type", true);
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    platformMajorVersion: 10,
    ItemFields: { getID: () => false },
  });
  installFakeNewItems();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an item from a paper's arXiv data", () => {
  it("is a preprint laid out as the plugin's arXiv preprints, with arXiv's DOI", async () => {
    const item = (await createItemFromArxiv(
      ENTRY,
      TARGET,
      LISTING,
    )) as unknown as FakeNewItem;

    expect(item.itemType).toBe("preprint");
    expect(item.fields).toEqual({
      title: "Hyperfine Structure of B and D Mesons in a QCD-Inspired Potential Model",
      abstractNote:
        "We study the hyperfine splitting of heavy-light mesons. A second line.",
      date: "2026-09-24",
      DOI: "10.48550/arXiv.2609.28544",
      url: "https://arxiv.org/abs/2609.28544",
      extra: "arXiv:2609.28544 [hep-ph]",
      archiveID: "arXiv:2609.28544",
      repository: "arXiv",
    });
    expect(item).toMatchObject({
      libraryID: 1,
      collections: [4],
      tags: ["to-read"],
      saves: [{ skipSelect: true }],
      marksAtSave: [["_zinspireCreatedByPlugin"]],
    });
  });

  it("writes the arXiv fields as an import of the same paper from INSPIRE writes them", async () => {
    const fromArxiv = (await createItemFromArxiv(
      ENTRY,
      TARGET,
      LISTING,
    )) as unknown as FakeNewItem;
    const fromInspire = new FakeNewItem("preprint");
    fromInspire.setField("extra", "");
    await setInspireMeta(
      fromInspire as any,
      {
        recid: 3061000,
        title: "Hyperfine Structure of B and D Mesons in a QCD-Inspired Potential Model",
        date: "2026-09-24",
        arxiv: { value: "2609.28544", categories: ["hep-ph", "hep-lat"] },
        urlArxiv: "https://arxiv.org/abs/2609.28544",
        document_type: ["article"],
        citation_count: 0,
        citation_count_wo_self_citations: 0,
      },
      "full",
    );
    for (const field of ["title", "date", "url", "archiveID", "repository"]) {
      expect(fromArxiv.fields[field], field).toBe(fromInspire.fields[field]);
    }
    // The arXiv line; INSPIRE's import adds its citation counts after it
    expect(fromInspire.fields.extra.split("\n")[0]).toBe(
      fromArxiv.fields.extra,
    );
  });

  it("is a journal article with only its type's fields when preprints are not kept", async () => {
    mocks.prefs.set("keep_preprint_type", false);
    mocks.prefs.set("arxiv_in_journal_abbrev", true);
    const item = (await createItemFromArxiv(
      ENTRY,
      TARGET,
    )) as unknown as FakeNewItem;
    expect(item.itemType).toBe("journalArticle");
    expect(item.fields).not.toHaveProperty("archiveID");
    expect(item.fields).not.toHaveProperty("repository");
    expect(item.fields).toMatchObject({
      extra: "arXiv:2609.28544 [hep-ph]",
      journalAbbreviation: "arXiv:2609.28544 [hep-ph]",
      DOI: "10.48550/arXiv.2609.28544",
    });
  });

  it("writes an old-style identifier without category and tags the primary category when asked", async () => {
    mocks.prefs.set("arxiv_tag_enable", true);
    // A replacement of an old paper, as in the math listing of 2026-09-25
    const item = (await createItemFromArxiv(
      {
        ...ENTRY,
        id: "math/0702261",
        primaryCategory: "math.GM",
        categories: ["math.GM"],
      },
      TARGET,
    )) as unknown as FakeNewItem;
    expect(item.fields.extra).toBe("arXiv:math/0702261");
    expect(item.fields.archiveID).toBe("arXiv:math/0702261");
    expect(item.tags).toEqual(["to-read", "math.GM"]);
  });

  it("tags nothing when category tags are off", async () => {
    const item = (await createItemFromArxiv(
      ENTRY,
      TARGET,
    )) as unknown as FakeNewItem;
    expect(item.tags).toEqual(["to-read"]);
  });
});

describe("the authors of an item from arXiv data", () => {
  it("keeps every author, split as the listing shows them", () => {
    expect(arxivCreators(ENTRY.authors, LISTING)).toEqual([
      { creatorType: "author", firstName: "Rahul", lastName: "Pathak" },
      { creatorType: "author", firstName: "Rohit", lastName: "Di Vora" },
      { creatorType: "author", firstName: "Akash Kumar", lastName: "Singh" },
    ]);
  });

  it("keeps an author the listing does not show at that place whole, in one field", () => {
    // The current version added an author before the others
    const authors = ["New Person", ...ENTRY.authors];
    expect(arxivCreators(authors, LISTING)).toEqual([
      { creatorType: "author", name: "New Person" },
      { creatorType: "author", name: "Rahul Pathak" },
      { creatorType: "author", name: "Rohit Di Vora" },
      { creatorType: "author", name: "Akash Kumar Singh" },
    ]);
  });

  it("keeps all authors of a paper whose listing shows only the first 100", () => {
    const authors = Array.from({ length: 150 }, (_, i) => `Given${i} Family${i}`);
    const listing = authors.slice(0, 100).map((display, i) => ({
      display,
      family: `Family${i}`,
      given: `Given${i}`,
    }));
    const creators = arxivCreators(authors, listing);
    expect(creators).toHaveLength(150);
    expect(creators[99]).toEqual({
      creatorType: "author",
      firstName: "Given99",
      lastName: "Family99",
    });
    expect(creators[100]).toEqual({
      creatorType: "author",
      name: "Given100 Family100",
    });
  });

  it("takes the listing's split when the names differ only in accents or spacing", () => {
    expect(
      arxivCreators(
        ["José  Müller"],
        [{ display: "Jose Muller", family: "Muller", given: "Jose" }],
      ),
    ).toEqual([
      { creatorType: "author", firstName: "Jose", lastName: "Muller" },
    ]);
  });

  it("keeps a listing author without arXiv's split whole", () => {
    expect(arxivCreators(["The ATLAS Collaboration"], [
      { display: "The ATLAS Collaboration" },
    ])).toEqual([{ creatorType: "author", name: "The ATLAS Collaboration" }]);
  });
});
