// ─────────────────────────────────────────────────────────────────────────────
// The entries of a paper's arXiv HTML bibliography matched to INSPIRE's
// reference list of the paper by their identifiers (arXiv links and
// "arXiv:" numbers, DOI links, journal references), never by their numbers;
// and INSPIRE's list read from the plugin's cache, else asked for with the
// cited papers' data and kept. Entry texts and links as arXiv's pages have
// them (arXiv:2610.02169, 1207.7214, hep-ph/0101001).
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("../src/modules/inspire/referencesService", () => ({
  fetchReferencesEntries: vi.fn(),
  enrichReferencesEntries: vi.fn(),
}));

import { localCache } from "../src/modules/inspire/localCache";
import {
  enrichReferencesEntries,
  fetchReferencesEntries,
} from "../src/modules/inspire/referencesService";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import {
  loadReferenceList,
  matchHtmlReferences,
  type HtmlReferenceEntry,
} from "../src/modules/arxiv/htmlReferences";

beforeEach(() => {
  (globalThis as any).Zotero = {
    debug: vi.fn(),
    Prefs: { get: vi.fn(() => undefined) },
  };
  vi.mocked(localCache.get).mockReset();
  vi.mocked(localCache.set).mockReset();
  vi.mocked(fetchReferencesEntries).mockReset();
  vi.mocked(enrichReferencesEntries).mockReset();
});

function reference(
  recid: string,
  extra: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: `entry-${recid}`,
    recid,
    title: `Paper ${recid}`,
    authors: [],
    authorText: "",
    ...extra,
  } as InspireReferenceEntry;
}

/** INSPIRE's list, its numbers (labels) unlike the page's */
const REFERENCES = [
  reference("1808912", {
    arxivDetails: { id: "2007.13313" },
    doi: "10.1007/JHEP11(2020)143",
    label: "1",
  } as Partial<InspireReferenceEntry>),
  reference("130411", {
    doi: "10.1016/0550-3213(78)90067-6",
    label: "2",
  } as Partial<InspireReferenceEntry>),
  reference("635943", {
    arxivDetails: { id: "hep-ph/0312266" },
    label: "3",
  } as Partial<InspireReferenceEntry>),
  reference("40000", {
    publicationInfo: {
      journal_title: "Phys.Rev.D",
      journal_volume: "50",
      page_start: "1297",
    },
    label: "4",
  } as Partial<InspireReferenceEntry>),
  reference("50000", {
    publicationInfo: {
      journal_title: "Phys.Rev.Lett.",
      journal_volume: "13",
      page_start: "508",
    },
    label: "5",
  } as Partial<InspireReferenceEntry>),
  reference("60000", {
    arxivDetails: { id: "2004.04545" },
    label: "6",
  } as Partial<InspireReferenceEntry>),
  reference("70000", {
    arxivDetails: { id: "hep-th/0012261" },
    label: "7",
  } as Partial<InspireReferenceEntry>),
  // JHEP's volumes are months: volume 08, page 137, of 2019
  reference("80000", {
    publicationInfo: {
      journal_title: "JHEP",
      journal_volume: "08",
      page_start: "137",
      year: 2019,
    },
    label: "8",
  } as Partial<InspireReferenceEntry>),
];

const entry = (
  id: string,
  text: string,
  links: string[] = [],
): HtmlReferenceEntry => ({ id, text, links });

describe("arXiv HTML bibliography matched to INSPIRE's reference list", () => {
  it("matches an entry by its DOI link (encoded as arXiv writes it), its arXiv link or its arXiv: number", () => {
    const matched = matchHtmlReferences(REFERENCES, [
      entry(
        "bib.bib1",
        "C. Duhr, F. Dulat, and B. Mistlberger (2020) Charged current Drell-Yan production at N3LO. JHEP 11, pp. 143. External Links: Document",
        ["https://dx.doi.org/10.1007/JHEP11%282020%29143"],
      ),
      entry(
        "bib.bib2",
        "C. Anastasiou, L. J. Dixon, K. Melnikov, and F. Petriello, High precision QCD at hadron colliders, Phys. Rev. D 69 (2004) 094008",
        ["http://arxiv.org/abs/hep-ph/0312266"],
      ),
      entry(
        "bib.bib3",
        "Duhr, Dulat and Mistlberger, JHEP 11 (2020) 143 [arXiv:2007.13313 [hep-ph]].",
      ),
    ]);
    expect([...matched]).toEqual([
      ["bib.bib1", [0]],
      ["bib.bib2", [2]],
      ["bib.bib3", [0]],
    ]);
  });

  it("matches by the journal, volume and first page of the text, also each paper of an entry naming several", () => {
    const matched = matchHtmlReferences(REFERENCES, [
      entry("bib.bib7", "I. Hinchliffe, Phys. Rev. D 50, 1297 (1994)."),
      entry(
        "bib.bib8",
        "I. Hinchliffe, Phys. Rev. D 50, 1297 (1994); P. W. Higgs, Phys. Rev. Lett. 13, 508 (1964).",
      ),
    ]);
    expect(matched.get("bib.bib7")).toEqual([3]);
    expect(matched.get("bib.bib8")).toEqual([3, 4]);
  });

  it("matches by the arXiv number among the entry's External Links (as arXiv's bibliographies from BibTeX give it), an old-style number in its text, and one written before a full stop", () => {
    const matched = matchHtmlReferences(REFERENCES, [
      entry(
        "bib.bib1",
        "G. Aad et al. (2020) Measurement of something. External Links: 2004.04545, Document",
        ["https://dx.doi.org/10.1000/not-in-the-list"],
      ),
      entry(
        "bib.bib2",
        "H. Roh, “QCD Confinement Mechanism and Θ Vacuum,” hep-th/0012261.",
      ),
      entry(
        "bib.bib3",
        "C. Duhr et al., JHEP 11 (2020) 143, arXiv:2007.13313.",
      ),
    ]);
    expect([...matched]).toEqual([
      ["bib.bib1", [5]],
      ["bib.bib2", [6]],
      ["bib.bib3", [0]],
    ]);
  });

  it("takes a journal reference only with the same year, and not besides an identifier the entry was matched by", () => {
    const matched = matchHtmlReferences(REFERENCES, [
      // Another year's JHEP 08, 137
      entry("bib.bib1", "A. Author, JHEP 08, 137 (2021)."),
      entry("bib.bib2", "B. Author, JHEP 08, 137 (2019)."),
      // Matched by its DOI: its text's journal reference is not read
      entry("bib.bib3", "C. Duhr et al., Phys. Rev. D 50, 1297 (1994).", [
        "https://doi.org/10.1007/JHEP11(2020)143",
      ]),
    ]);
    expect(matched.has("bib.bib1")).toBe(false);
    expect(matched.get("bib.bib2")).toEqual([7]);
    expect(matched.get("bib.bib3")).toEqual([0]);
  });

  it("does not match an entry without an identifier INSPIRE's list has, whatever its number", () => {
    const matched = matchHtmlReferences(REFERENCES, [
      // The page's number 1 is INSPIRE's label 1, but the entry is a book
      entry(
        "bib.bib1",
        "R. Greiner and J. Reinhardt, Field Quantization (Springer-Verlag, 1996).",
      ),
      entry("bib.bib2", "A. Author, a talk", ["https://example.org/talk"]),
      entry("bib.bib3", "B. Author, Phys. Rev. D 51, 1297 (1995)."),
      entry("bib.bib4", "", ["https://doi.org/10.1000/unknown"]),
    ]);
    expect(matched.size).toBe(0);
  });
});

describe("INSPIRE's reference list of a paper, through the plugin's cache", () => {
  const complete = (processed: string[] = []) => ({
    processedRecids: processed,
    unresolvedRecids: [],
    failedRecids: [],
    complete: true,
  });

  it("reads a cached list with its papers' data and asks INSPIRE for nothing", async () => {
    const cached = [reference("1")];
    vi.mocked(localCache.get).mockResolvedValue({
      data: cached,
      fromCache: true,
      ageHours: 3,
    });
    vi.mocked(enrichReferencesEntries).mockResolvedValue(complete());
    expect(await loadReferenceList("100")).toBe(cached);
    expect(localCache.get).toHaveBeenCalledWith("refs", "100");
    expect(fetchReferencesEntries).not.toHaveBeenCalled();
    expect(localCache.set).not.toHaveBeenCalled();
  });

  it("completes a cached list kept without its papers' data, and keeps it so", async () => {
    const cached = [reference("1"), reference("2")];
    vi.mocked(localCache.get).mockResolvedValue({
      data: cached,
      fromCache: true,
      ageHours: 3,
    });
    vi.mocked(enrichReferencesEntries).mockResolvedValue(complete(["1", "2"]));
    expect(await loadReferenceList("100")).toBe(cached);
    expect(localCache.set).toHaveBeenCalledWith(
      "refs",
      "100",
      cached,
      undefined,
      2,
    );
  });

  it("asks INSPIRE for a list not cached, and keeps it once complete", async () => {
    const fetched = [reference("1")];
    vi.mocked(localCache.get).mockResolvedValue(null);
    vi.mocked(fetchReferencesEntries).mockResolvedValue(fetched);
    vi.mocked(enrichReferencesEntries).mockResolvedValue(complete(["1"]));
    const signal = new AbortController().signal;
    expect(await loadReferenceList("100", signal)).toBe(fetched);
    expect(fetchReferencesEntries).toHaveBeenCalledWith("100", { signal });
    expect(enrichReferencesEntries).toHaveBeenCalledWith(fetched, { signal });
    expect(localCache.set).toHaveBeenCalledWith(
      "refs",
      "100",
      fetched,
      undefined,
      1,
    );
  });

  it("does not keep a list whose papers' data did not all arrive, nor an empty one", async () => {
    vi.mocked(localCache.get).mockResolvedValue(null);
    vi.mocked(fetchReferencesEntries).mockResolvedValue([reference("1")]);
    vi.mocked(enrichReferencesEntries).mockResolvedValue({
      ...complete(),
      failedRecids: ["1"],
      complete: false,
    });
    await loadReferenceList("100");
    vi.mocked(fetchReferencesEntries).mockResolvedValue([]);
    vi.mocked(enrichReferencesEntries).mockResolvedValue(complete());
    expect(await loadReferenceList("101")).toEqual([]);
    expect(localCache.set).not.toHaveBeenCalled();
  });

  it("rejects when INSPIRE does not answer", async () => {
    vi.mocked(localCache.get).mockResolvedValue(null);
    vi.mocked(fetchReferencesEntries).mockRejectedValue(
      new Error("Reference list not found"),
    );
    await expect(loadReferenceList("100")).rejects.toThrow();
    expect(localCache.set).not.toHaveBeenCalled();
  });
});
