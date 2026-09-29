// ─────────────────────────────────────────────────────────────────────────────
// The arXiv category tag: the primary category (hep-ph, math.RT), from the
// caller's data when known, else from Extra's arXiv line; an old-style
// identifier's archive only when nothing better is known; an item already
// tagged with its archive by earlier versions is not retagged. The INSPIRE
// update and the preprint watch's publication update tag through it.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prefs: new Map<string, unknown>(),
  fetchMeta: vi.fn(),
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

import { addArxivCategoryTag } from "../src/modules/inspire/arxivTag";
import { setInspireMeta } from "../src/modules/inspire/itemUpdater";
import { updatePreprintWithPublicationInfo } from "../src/modules/inspire/preprintWatchService";
import { FakeNewItem, installFakeNewItems } from "./fakeNewItem";

function item(extra: string, tags: string[] = []) {
  const it = new FakeNewItem("journalArticle");
  it.setField("extra", extra);
  it.tags = [...tags];
  return it;
}

beforeEach(() => {
  mocks.prefs.clear();
  mocks.prefs.set("arxiv_tag_enable", true);
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

describe("the arXiv category tag", () => {
  it("is the primary category the caller knows, also for an old-style identifier", () => {
    const it = item("arXiv:math/0501001");
    expect(addArxivCategoryTag(it as any, "math.RT")).toBe(true);
    expect(it.tags).toEqual(["math.RT"]);
  });

  it("is the category of Extra's arXiv line when the caller knows none", () => {
    const it = item("arXiv:2609.28544 [hep-ph]");
    addArxivCategoryTag(it as any);
    expect(it.tags).toEqual(["hep-ph"]);
  });

  it("is an old-style identifier's archive only when nothing better is known", () => {
    const it = item("arXiv:cond-mat/9807323");
    addArxivCategoryTag(it as any);
    expect(it.tags).toEqual(["cond-mat"]);
  });

  it("leaves an item tagged with its archive by earlier versions as it is", () => {
    const it = item("arXiv:cond-mat/9807323", ["cond-mat"]);
    expect(addArxivCategoryTag(it as any, "cond-mat.mtrl-sci")).toBe(false);
    expect(it.tags).toEqual(["cond-mat"]);
  });

  it("is not added twice, nor when the option is off", () => {
    const it = item("arXiv:2609.28544 [hep-ph]", ["hep-ph"]);
    expect(addArxivCategoryTag(it as any, "hep-ph")).toBe(false);
    mocks.prefs.set("arxiv_tag_enable", false);
    const off = item("arXiv:2609.28544 [hep-ph]");
    expect(addArxivCategoryTag(off as any, "hep-ph")).toBe(false);
    expect(off.tags).toEqual([]);
  });
});

describe("the writers that tag", () => {
  const META = {
    recid: 1234,
    title: "An old paper",
    arxiv: { value: "math/0501001", categories: ["math.RT"] },
    document_type: ["article"],
    journalAbbreviation: "J. Alg.",
    citation_count: 1,
    citation_count_wo_self_citations: 1,
  };

  it("the INSPIRE update tags an old-style paper with its primary category", async () => {
    const it = item("");
    await setInspireMeta(it as any, META, "full");
    expect(it.fields.extra).toContain("arXiv:math/0501001");
    expect(it.tags).toEqual(["math.RT"]);
  });

  it("the preprint watch's publication update tags an old-style paper with its primary category", async () => {
    mocks.fetchMeta.mockResolvedValue(META);
    const it = item("arXiv:math/0501001");
    await updatePreprintWithPublicationInfo(
      it as any,
      {
        journalTitle: "J. Alg.",
        recid: "1234",
      } as any,
    );
    expect(it.tags).toEqual(["math.RT"]);
  });
});
