// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE records of arXiv papers by arXiv identifier: batches, exact
// attribution of a record to an identifier, failed and unanswered batches,
// the hour in which an automatic lookup does not ask again about a paper
// INSPIRE had no record of, and the identity check against a Zotero item.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: vi.fn(),
}));
vi.mock("../src/utils/prefs", () => ({ getPref: vi.fn() }));
vi.mock("../src/utils/locale", () => ({ getString: (key: string) => key }));

import { inspireFetch } from "../src/modules/inspire/rateLimiter";
import {
  clearNotFoundMemory,
  identityMismatches,
  lookupInspireByArxiv,
  resolveInspireByArxiv,
  titleOverlap,
  TITLE_OVERLAP_MIN,
} from "../src/modules/arxiv/inspireByArxiv";

const fetchMock = vi.mocked(inspireFetch);

/** INSPIRE's records, by the arXiv identifier they list */
let records: Map<string, any>;

function requestedIds(url: string): string[] {
  const query = new URL(url).searchParams.get("q") ?? "";
  return query.split(" OR ").map((term) => term.replace(/^arxiv:/, ""));
}

function answer(url: string): Response {
  const hits = requestedIds(url)
    .map((id) => records.get(id))
    .filter(Boolean)
    .map((metadata) => ({ id: String(metadata.control_number), metadata }));
  return new Response(JSON.stringify({ hits: { hits, total: hits.length } }), {
    status: 200,
  });
}

function record(recid: number, ...eprints: string[]) {
  const metadata = {
    control_number: recid,
    arxiv_eprints: eprints.map((value) => ({ value })),
  };
  for (const eprint of eprints)
    records.set(eprint.replace(/v\d+$/, ""), metadata);
  return metadata;
}

beforeEach(() => {
  records = new Map();
  clearNotFoundMemory();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) => answer(String(url)));
  vi.stubGlobal("Zotero", { debug: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("INSPIRE lookup by arXiv identifier", () => {
  it("asks about 50 papers per request, for as many records, with the fields asked for", async () => {
    const ids = Array.from(
      { length: 120 },
      (_, i) => `2609.${String(10000 + i)}`,
    );
    ids.forEach((id, i) => record(3000000 + i, id));

    const answers = await lookupInspireByArxiv(ids, { fields: ["texkeys"] });

    const urls = fetchMock.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls.map((url) => requestedIds(url.href).length)).toEqual([
      50, 50, 20,
    ]);
    expect(urls.map((url) => url.searchParams.get("size"))).toEqual([
      "50",
      "50",
      "20",
    ]);
    expect(urls[0].searchParams.get("fields")).toBe(
      "control_number,arxiv_eprints,texkeys",
    );
    expect(answers.get("2609.10007")).toMatchObject({
      status: "found",
      recid: "3000007",
    });
    expect([...answers.values()].every((a) => a.status === "found")).toBe(true);
  });

  it("says when INSPIRE answered and whether the record's DOIs were asked for", async () => {
    record(51, "2609.60001");
    const withDois = await lookupInspireByArxiv(["2609.60001"], {
      fields: ["dois.value"],
    });
    const without = await lookupInspireByArxiv(["2609.60001"]);
    expect(withDois.get("2609.60001")).toMatchObject({
      withDois: true,
      at: expect.any(Number),
    });
    expect(without.get("2609.60001")).toMatchObject({ withDois: false });
  });

  it("takes a record only for an identifier it lists exactly", async () => {
    // A search hit that lists another paper (an old-style number with a
    // subject class, a version) counts only for what it really lists
    record(11, "hep-ph/0101001");
    record(12, "2609.20001v2");
    records.set("2609.20002", {
      control_number: 13,
      arxiv_eprints: [{ value: "2609.20003" }],
    });

    const answers = await lookupInspireByArxiv([
      "hep-ph/0101001",
      "2609.20001",
      "2609.20002",
    ]);

    expect(answers.get("hep-ph/0101001")).toMatchObject({ recid: "11" });
    expect(answers.get("2609.20001")).toMatchObject({ recid: "12" });
    expect(answers.get("2609.20002")).toMatchObject({ status: "notFound" });
  });

  it("finds a paper by either of the two identifiers its record lists", async () => {
    record(21, "2301.00001", "2301.00002");
    const answers = await lookupInspireByArxiv(["2301.00001", "2301.00002"]);
    expect(answers.get("2301.00001")).toMatchObject({ recid: "21" });
    expect(answers.get("2301.00002")).toMatchObject({ recid: "21" });
  });

  it("tells papers INSPIRE did not answer about from papers it has no record of", async () => {
    record(31, "2609.30001");
    fetchMock.mockImplementation(async (url) =>
      requestedIds(String(url)).includes("2609.30003")
        ? new Response("Bad Gateway", { status: 502 })
        : answer(String(url)),
    );
    const ids = [
      "2609.30001",
      ...Array.from({ length: 48 }, (_, i) => `2609.${31000 + i}`),
      "2609.30003",
    ];

    const answers = await lookupInspireByArxiv(ids);

    // The 502 batch was split in halves; the half without 2609.30003 answered
    expect(
      fetchMock.mock.calls.map((call) => requestedIds(String(call[0])).length),
    ).toEqual([50, 25, 25]);
    expect(answers.get("2609.30001")).toMatchObject({ status: "found" });
    expect(answers.get("2609.30003")).toEqual({ status: "failed" });
    expect(answers.get("2609.31000")?.status).toBe("notFound");
    expect(answers.get("2609.31030")?.status).toBe("failed");
  });

  it("does not ask again automatically within an hour about a paper INSPIRE had no record of", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 8, 29, 3));
    await lookupInspireByArxiv(["2609.40001"], { automatic: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.UTC(2026, 8, 29, 3, 59));
    const again = await lookupInspireByArxiv(["2609.40001"], {
      automatic: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.get("2609.40001")).toEqual({
      status: "notFound",
      at: Date.UTC(2026, 8, 29, 3),
    });

    // Asked for by the user: asked at once
    await lookupInspireByArxiv(["2609.40001"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // INSPIRE has the record by now; after the hour, asked again
    record(41, "2609.40001");
    vi.setSystemTime(Date.UTC(2026, 8, 29, 5));
    const later = await lookupInspireByArxiv(["2609.40001"], {
      automatic: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(later.get("2609.40001")).toMatchObject({ recid: "41" });
  });

  it("ends with an AbortError when cancelled", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await expect(
      lookupInspireByArxiv(["2609.50001"], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("the identity check of an item's INSPIRE record", () => {
  function inspire(title: string, lastName: string, fullName?: string) {
    return {
      titles: [{ title }],
      first_author: { last_name: lastName, full_name: fullName },
    };
  }

  it("accepts the record of the item's paper", () => {
    expect(
      identityMismatches(
        {
          arxivId: "2609.28544",
          title:
            "Hyperfine Structure of B and D Mesons in a QCD-Inspired Potential Model",
          firstAuthor: { lastName: "Pathak" },
        },
        inspire(
          "Hyperfine structure of B and D mesons in a QCD-inspired potential model",
          "Pathak",
        ),
      ),
    ).toEqual([]);
  });

  it("reports another paper's title and first author", () => {
    expect(
      identityMismatches(
        {
          arxivId: "2609.28544",
          title: "Sneaky Sneutrino Scattering at LZ",
          firstAuthor: { lastName: "Pathak" },
        },
        inspire(
          "Quantum field-theoretical description of solar neutrino oscillations",
          "Egorov",
        ),
      ),
    ).toEqual(["title", "firstAuthor"]);
  });

  it("reports a record without a title or first author as incomplete", () => {
    expect(
      identityMismatches(
        {
          arxivId: "2609.1",
          title: "A title",
          firstAuthor: { lastName: "Smith" },
        },
        { titles: [{ title: "A title" }] },
      ),
    ).toEqual(["recordIncomplete"]);
  });

  it("compares family names without accents and case, with particles, and whole names", () => {
    const record = inspire("A title of a paper", "Müller");
    const check = (lastName: string | undefined) =>
      identityMismatches(
        {
          arxivId: "2609.1",
          title: "A title of a paper",
          firstAuthor: lastName === undefined ? undefined : { lastName },
        },
        record,
      );
    expect(check("Muller")).toEqual([]);
    expect(check("müller")).toEqual([]);
    // An author stored as one field (Zotero's single-field mode)
    expect(check("Hans Müller")).toEqual([]);
    expect(check("Mueller")).toEqual(["firstAuthor"]);
    expect(check(undefined)).toEqual(["firstAuthor"]);
    // arXiv splits "G. Sardo Infirri" into family "Infirri"
    expect(
      identityMismatches(
        {
          arxivId: "2609.1",
          title: "A title of a paper",
          firstAuthor: { lastName: "Infirri" },
        },
        inspire("A title of a paper", "Sardo Infirri"),
      ),
    ).toEqual([]);
    expect(
      identityMismatches(
        {
          arxivId: "2609.1",
          title: "A title of a paper",
          firstAuthor: { lastName: "Di Vora" },
        },
        inspire("A title of a paper", "", "Di Vora, R."),
      ),
    ).toEqual([]);
  });

  // arXiv and Zotero's arXiv translator give a collaboration paper the
  // collaboration as author; INSPIRE's first author is a member (arXiv
  // 2604.20999, INSPIRE 3148721). Forms of the owner's library.
  it.each([
    [{ lastName: "CMS Collaboration" }],
    [{ firstName: "CMS", lastName: "Collaboration" }],
    [{ firstName: "C. M. S.", lastName: "Collaboration" }],
  ])(
    "accepts a collaboration as the first author of its record: %j",
    (firstAuthor) => {
      expect(
        identityMismatches(
          {
            arxivId: "2604.20999",
            title:
              "Search for dark matter produced in association with a dark Higgs boson decaying into a bottom quark-antiquark pair",
            firstAuthor,
          },
          {
            titles: [
              {
                title:
                  "Search for dark matter produced in association with a dark Higgs boson decaying into a bottom quark-antiquark pair in proton-proton collisions at 13 TeV",
              },
            ],
            first_author: {
              full_name: "Hayrapetyan, Aram",
              last_name: "Hayrapetyan",
            },
            collaborations: [{ value: "CMS" }],
          },
        ),
      ).toEqual([]);
    },
  );

  it("does not take another collaboration, or a person, for the record's collaboration", () => {
    const record = {
      titles: [{ title: "A measurement" }],
      first_author: { last_name: "Aad" },
      collaborations: [{ value: "ATLAS" }],
    };
    const check = (firstAuthor: { lastName: string; firstName?: string }) =>
      identityMismatches(
        { arxivId: "2604.1", title: "A measurement", firstAuthor },
        record,
      );
    expect(check({ firstName: "CMS", lastName: "Collaboration" })).toEqual([
      "firstAuthor",
    ]);
    expect(check({ firstName: "Atlas", lastName: "Smith" })).toEqual([
      "firstAuthor",
    ]);
    expect(check({ firstName: "Atlas", lastName: "Collaboration" })).toEqual(
      [],
    );
  });

  // The closest pairs of the 168 real papers the threshold was set from
  // (arXiv listings of 2026-09-21 and 25): the item title is the arXiv
  // API's title through the plugin's formula conversion, as a paper added
  // from arXiv data gets it
  it.each([
    [
      "Open-flavor threshold effects on quarkonium spectrum in the BOEFT",
      "Open-flavor threshold effects on quarkonium spectrum in the Born-Oppenheimer effective field theory",
    ],
    [
      "Discovering μHz gravitational waves and ultra-light dark matter with binary resonances",
      'Discovering <math display="inline"><mrow><mi mathvariant="normal">μ</mi><mi>Hz</mi></mrow></math> Gravitational Waves and Ultralight Dark Matter with Binary Resonances',
    ],
    [
      "Precise determination of the properties of X(3872) and of its isovector partner W<sub>c1</sub>",
      'Precise determination of the properties of <math altimg="si45.svg"><mrow><mi>X</mi><mo stretchy="true">(</mo><mn>3872</mn><mo stretchy="true">)</mo></mrow></math> and of its isovector partner <math altimg="si46.svg"><mrow><msub><mrow><mi>W</mi></mrow><mrow><mi>c</mi><mn>1</mn></mrow></msub></mrow></math>',
    ],
  ])("takes the same paper's titles as the same: %s", (item, record) => {
    expect(titleOverlap(item, record)).toBeGreaterThanOrEqual(
      TITLE_OVERLAP_MIN,
    );
  });

  it.each([
    [
      "LZ nuclear recoil event from inelastic singlet-doublet scalar dark matter",
      "Effect of inelastic scalar dark matter in hidden $U(1)$ scenario after the LZ nuclear recoil",
    ],
    [
      "Discovering μHz gravitational waves and ultra-light dark matter with binary resonances",
      "Prospects for gravitational wave and ultralight dark matter detection with binary resonances beyond the secular approximation",
    ],
  ])("takes different papers' titles as different: %s", (item, record) => {
    expect(titleOverlap(item, record)).toBeLessThan(TITLE_OVERLAP_MIN);
  });

  it("asks once for items with the same arXiv ID and checks each item", async () => {
    records.set("2609.28544", {
      control_number: 3061000,
      arxiv_eprints: [{ value: "2609.28544" }],
      titles: [
        {
          title:
            "Hyperfine structure of B and D mesons in a QCD-inspired potential model",
        },
      ],
      first_author: { full_name: "Pathak, K.", last_name: "Pathak" },
    });

    const resolved = await resolveInspireByArxiv(
      [
        {
          arxivId: "2609.28544",
          title:
            "Hyperfine Structure of B and D Mesons in a QCD-Inspired Potential Model",
          firstAuthor: { lastName: "Pathak" },
        },
        // The same arXiv ID typed into another paper's item
        {
          arxivId: "2609.28544",
          title: "Sneaky Sneutrino Scattering at LZ",
          firstAuthor: { lastName: "Bhupal Dev" },
        },
        {
          arxivId: "2609.99999",
          title: "Not yet",
          firstAuthor: { lastName: "Nobody" },
        },
      ],
      { fields: ["texkeys"] },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("fields"),
    ).toBe(
      "control_number,arxiv_eprints,titles.title,first_author.full_name,first_author.last_name,collaborations.value,texkeys",
    );
    expect(resolved).toEqual([
      expect.objectContaining({
        status: "found",
        recid: "3061000",
        mismatches: [],
      }),
      expect.objectContaining({
        status: "found",
        recid: "3061000",
        mismatches: ["title", "firstAuthor"],
      }),
      { status: "notFound" },
    ]);
  });
});
