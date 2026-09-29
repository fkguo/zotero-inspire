// ─────────────────────────────────────────────────────────────────────────────
// No author of an item is dropped by an update from INSPIRE without the
// user's say: INSPIRE keeps the first 3 of more than 10 authors, so an item
// that has the whole list (added from arXiv data, from a journal, by hand)
// keeps it through the update from INSPIRE, the preprint watch's
// publication update and smart update; smart update's preview offers the
// shorter list unticked.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMeta: vi.fn(),
  prefs: new Map<string, unknown>(),
}));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: () => undefined,
}));
vi.mock("../src/utils/locale", () => ({ getString: (key: string) => key }));
vi.mock("../src/modules/inspire/metadataService", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchInspireMetaByRecid: mocks.fetchMeta,
}));

import {
  authorsWouldBeLost,
  compareItemWithInspire,
  creatorsForUpdate,
  mergeCreatorsWithProtectedNames,
} from "../src/modules/inspire/smartUpdate";
import { setInspireMeta } from "../src/modules/inspire/itemUpdater";
import { updatePreprintWithPublicationInfo } from "../src/modules/inspire/preprintWatchService";
import { FakeNewItem, installFakeNewItems } from "./fakeNewItem";

const person = (lastName: string, firstName: string) => ({
  lastName,
  firstName,
  creatorType: "author",
});
const others = { name: "others", creatorType: "author" };

/** A 15-author paper as arXiv lists it */
const FULL = Array.from({ length: 15 }, (_, i) =>
  person(`Family${i}`, `Given${i}`),
);
/** The same paper as the INSPIRE import gives it: first 3 and "others" */
const INSPIRE_SHORT = [...FULL.slice(0, 3).map((c) => ({ ...c })), others];

beforeEach(() => {
  mocks.prefs.clear();
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    platformMajorVersion: 10,
    ItemFields: { getID: () => false },
    ItemTypes: { getID: () => 1 },
  });
  installFakeNewItems();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whether an author list from INSPIRE drops authors", () => {
  it("drops authors when it is the first 3 and others of a full list", () => {
    expect(authorsWouldBeLost(FULL, INSPIRE_SHORT)).toBe(true);
  });

  it("drops an author when a list of the same length names someone else", () => {
    const swapped = [...FULL.slice(0, 14), person("Newcomer", "N.")];
    expect(authorsWouldBeLost(FULL, swapped)).toBe(true);
  });

  it("drops one of two authors of the same name the new list has once", () => {
    const local = [
      person("Wang", "J."),
      person("Wang", "Jun"),
      person("Li", "X."),
    ];
    const incoming = [person("Wang", "Jian"), person("Li", "Xin")];
    expect(authorsWouldBeLost(local, incoming)).toBe(true);
    expect(
      authorsWouldBeLost(local, [...incoming, person("Wang", "Jun")]),
    ).toBe(false);
  });

  it("drops no one when the new list completes names, adds authors or changes accents", () => {
    const local = [person("Muller", "J. R."), person("Di Vora", "R.")];
    expect(
      authorsWouldBeLost(local, [
        person("Müller", "Johann Robert"),
        person("Di Vora", "Rohit"),
        person("Third", "T."),
      ]),
    ).toBe(false);
    // The INSPIRE import's own short list against the same short list
    expect(authorsWouldBeLost(INSPIRE_SHORT, INSPIRE_SHORT)).toBe(false);
    expect(authorsWouldBeLost([], INSPIRE_SHORT)).toBe(false);
  });

  it("takes two authors whose given names only share the initial for different people", () => {
    // Real in Chinese names: Wang Jun and Wang Jing
    const local = [person("Wang", "Jun"), person("Wang", "Jian")];
    expect(
      authorsWouldBeLost(local, [
        person("Wang", "Jian"),
        person("Wang", "Jing"),
      ]),
    ).toBe(true);
    expect(
      authorsWouldBeLost(local, [person("Wang", "J."), person("Wang", "Jian")]),
    ).toBe(false);
    expect(
      authorsWouldBeLost(
        [person("Chen", "Hua-Xing")],
        [person("Chen", "Hua Xing")],
      ),
    ).toBe(false);
  });

  it("takes Mueller and Muller for the same name", () => {
    expect(
      authorsWouldBeLost([person("Mueller", "J.")], [person("Muller", "John")]),
    ).toBe(false);
  });

  it("takes an editor for someone else than an author of the same name", () => {
    expect(
      authorsWouldBeLost(
        [{ ...person("Smith", "A."), creatorType: "editor" }],
        [person("Smith", "A.")],
      ),
    ).toBe(true);
  });

  it("keeps the item's list when the new one drops authors, else writes the new one", () => {
    expect(creatorsForUpdate(FULL as any, INSPIRE_SHORT as any, [])).toBe(FULL);
    const completed = [person("Pathak", "Rahul")];
    expect(
      creatorsForUpdate([person("Pathak", "R.")] as any, completed as any, []),
    ).toBe(completed);
  });
});

describe("names kept as the item writes them", () => {
  it("keeps each of two protected authors of the same family name in its place", () => {
    const local = [person("Wang", "Jun"), person("Wang", "Jian")];
    const incoming = [person("Wang", "J."), person("Wang", "Jian")];
    // Both "Wang": protected by family name
    expect(creatorsForUpdate(local as any, incoming as any, ["wang"])).toEqual([
      person("Wang", "Jun"),
      person("Wang", "Jian"),
    ]);
  });

  it("keeps the accents of two authors of the same family name, each once", () => {
    const local = [person("Müller", "Anna"), person("Müller", "Bernd")];
    const incoming = [person("Mueller", "A."), person("Mueller", "B.")];
    expect(
      mergeCreatorsWithProtectedNames(local as any, incoming as any, []),
    ).toEqual(local);
  });
});

describe("the writers of authors", () => {
  const META = {
    recid: 3061000,
    title: "A paper",
    creators: INSPIRE_SHORT,
    document_type: ["article"],
    citation_count: 0,
    citation_count_wo_self_citations: 0,
  };

  function itemWith(creators: object[]) {
    const item = new FakeNewItem("journalArticle");
    item.setField("extra", "");
    item.setCreators(creators.map((c) => ({ ...c })));
    return item;
  }

  it("the update from INSPIRE keeps an item's full list", async () => {
    const item = itemWith(FULL);
    await setInspireMeta(item as any, META, "full");
    expect(item.creators).toEqual(FULL);
  });

  it("the update from INSPIRE still writes INSPIRE's list where it drops no one", async () => {
    const item = itemWith([person("Family0", "G.")]);
    await setInspireMeta(item as any, META, "full");
    expect(item.creators).toEqual(INSPIRE_SHORT);
  });

  it("the preprint watch's publication update keeps an item's full list", async () => {
    mocks.fetchMeta.mockResolvedValue({
      ...META,
      journalAbbreviation: "Phys. Rev. D",
    });
    const item = itemWith(FULL);
    await updatePreprintWithPublicationInfo(
      item as any,
      {
        journalTitle: "Phys. Rev. D",
        recid: "3061000",
      } as any,
    );
    expect(item.creators).toEqual(FULL);
    expect(item.fields.archiveLocation).toBe(3061000);
  });

  it("smart update marks a list that drops authors, to be offered unticked", () => {
    const item = itemWith(FULL);
    const diff = compareItemWithInspire(item as any, META as any);
    expect(diff.changes.find((c) => c.field === "creators")).toMatchObject({
      conflict: "authorsLost",
    });
    const completing = itemWith([person("Family0", "G.")]);
    const other = compareItemWithInspire(completing as any, META as any);
    expect(
      other.changes.find((c) => c.field === "creators")?.conflict,
    ).toBeUndefined();
  });
});
