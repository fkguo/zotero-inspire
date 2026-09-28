// ─────────────────────────────────────────────────────────────────────────────
// The INSPIRE recid of a Zotero item
//
// Fixes, for a set of field layouts, the recid the plugin reads from an item
// (deriveRecidFromItem, used by the panel, the citation graph, the reader and
// the new-item hook) and the INSPIRE lookup the metadata service makes for it
// (by DOI, arXiv ID or recid).
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: vi.fn(),
}));

import { inspireFetch } from "../src/modules/inspire/rateLimiter";
import {
  deriveRecidFromItem,
  recidLookupCache,
} from "../src/modules/inspire/apiUtils";
import {
  fetchRecidFromInspire,
  getInspireMeta,
} from "../src/modules/inspire/metadataService";
import hooks from "../src/hooks";

type Fields = Record<string, string>;

function fakeItem(fields: Fields): any {
  return {
    id: 1,
    libraryID: 1,
    itemType: "journalArticle",
    getField: (field: string) => fields[field] ?? "",
  };
}

beforeEach(() => {
  (globalThis as any).Zotero = { debug: vi.fn() };
  vi.mocked(inspireFetch).mockReset();
  vi.mocked(inspireFetch).mockResolvedValue({ status: 404 } as any);
});

/** The INSPIRE API path the metadata service asks for the item, or null */
async function lookupPath(fields: Fields): Promise<string | null> {
  vi.mocked(inspireFetch).mockClear();
  await getInspireMeta(fakeItem(fields), "literatureLookup");
  const calls = vi.mocked(inspireFetch).mock.calls;
  if (calls.length === 0) return null;
  return String(calls[0][0])
    .replace(/^https:\/\/inspirehep\.net\/api\//, "")
    .replace(/\?fields=.*$/, "");
}

interface Results {
  recid: string | null;
  lookup: string | null;
}

interface Row extends Results {
  name: string;
  fields: Fields;
  /** Intentional behaviour changes: the new results and their reason */
  changed?: Partial<Results> & { reason: string };
}

function now<K extends keyof Results>(row: Row, key: K): Results[K] {
  return row.changed && key in row.changed
    ? (row.changed[key] as Results[K])
    : row[key];
}

/**
 * The plugin keeps an item's recid in Archive Location and writes citation
 * counts, not links, to Extra; no item of the owner's library has an INSPIRE
 * link there
 */
const EXTRA_NOT_READ = "Extra is not read for a recid";

const ROWS: Row[] = [
  // ── Archive Location ────────────────────────────────────────────────────
  {
    name: "Archive INSPIRE, recid in Archive Location (the plugin's layout)",
    fields: { archive: "INSPIRE", archiveLocation: "1234567" },
    recid: "1234567",
    lookup: "literature/1234567",
  },
  {
    name: "Archive in other case and with spaces",
    fields: { archive: " inspire ", archiveLocation: "1234567" },
    recid: "1234567",
    lookup: "literature/1234567",
  },
  {
    name: "Archive Location with spaces",
    fields: { archive: "INSPIRE", archiveLocation: " 1234567 " },
    recid: "1234567",
    lookup: null,
    changed: {
      lookup: "literature/1234567",
      reason:
        "the lookup reads Archive Location by the recid rule, which ignores spaces around it",
    },
  },
  {
    name: "number in Archive Location, Archive empty",
    fields: { archiveLocation: "1234567" },
    recid: "1234567",
    lookup: "literature/1234567",
    changed: {
      recid: null,
      lookup: null,
      reason:
        "a number in Archive Location is a recid only under Archive INSPIRE",
    },
  },
  {
    name: "number in Archive Location, Archive a shelf name",
    fields: { archive: "Institute library", archiveLocation: "1234567" },
    recid: "1234567",
    lookup: "literature/1234567",
    changed: {
      recid: null,
      lookup: null,
      reason:
        "a number in Archive Location is a recid only under Archive INSPIRE",
    },
  },
  {
    name: "arXiv ID in Archive Location with Archive arXiv",
    fields: { archive: "arXiv", archiveLocation: "2301.12345" },
    recid: null,
    lookup: "literature/2301.12345",
    changed: {
      lookup: null,
      reason: "an arXiv ID is not a recid (INSPIRE has no record 2301.12345)",
    },
  },
  {
    name: "call number starting with digits in Archive Location",
    fields: { archiveLocation: "530.1 GUO" },
    recid: null,
    lookup: "literature/530.1%20GUO",
    changed: {
      lookup: null,
      reason: "only a whole number under Archive INSPIRE is a recid",
    },
  },
  // ── URL ─────────────────────────────────────────────────────────────────
  {
    name: "INSPIRE literature URL",
    fields: { url: "https://inspirehep.net/literature/1234567" },
    recid: "1234567",
    lookup: "literature/1234567",
  },
  {
    name: "INSPIRE literature URL with a query",
    fields: {
      url: "https://inspirehep.net/literature/1234567?ui-citation-summary=true",
    },
    recid: "1234567",
    lookup: "literature/1234567%3Fui-citation-summary%3Dtrue",
    changed: {
      lookup: "literature/1234567",
      reason: "the URL is read as a link: its query is not part of the recid",
    },
  },
  {
    name: "INSPIRE API URL",
    fields: { url: "https://inspirehep.net/api/literature/1234567" },
    recid: "1234567",
    lookup: "literature/1234567",
  },
  {
    name: "legacy INSPIRE record URL",
    fields: { url: "http://inspirehep.net/record/1234567" },
    recid: "1234567",
    lookup: null,
    changed: {
      lookup: "literature/1234567",
      reason:
        "the lookup reads the URL's recid by the shared rule, which takes legacy /record/ links",
    },
  },
  {
    name: "literature URL of another site",
    fields: { url: "https://example.org/literature/1234567" },
    recid: null,
    lookup: "literature/1234567",
    changed: {
      lookup: null,
      reason: "only links to inspirehep.net give a recid",
    },
  },
  {
    name: "CDS record URL",
    fields: { url: "https://cds.cern.ch/record/1986460" },
    recid: null,
    lookup: null,
  },
  // ── Extra ───────────────────────────────────────────────────────────────
  {
    name: "the plugin's INSPIRE citation counts in Extra",
    fields: {
      extra:
        "12 citations (INSPIRE 2026/9/28)\n10 citations w/o self (INSPIRE 2026/9/28)",
    },
    recid: null,
    lookup: null,
  },
  {
    name: "INSPIRE literature link in Extra",
    fields: { extra: "INSPIRE: https://inspirehep.net/literature/1234567" },
    recid: "1234567",
    lookup: null,
    changed: { recid: null, reason: EXTRA_NOT_READ },
  },
  {
    name: "legacy record link in Extra",
    fields: { extra: "http://inspirehep.net/record/1234567" },
    recid: "1234567",
    lookup: null,
    changed: { recid: null, reason: EXTRA_NOT_READ },
  },
  {
    name: "scheme-relative INSPIRE link in Extra",
    fields: { extra: "see //inspirehep.net/literature/1234567" },
    recid: "1234567",
    lookup: null,
    changed: { recid: null, reason: EXTRA_NOT_READ },
  },
  {
    name: "INSPIRE API link in Extra",
    fields: { extra: "https://inspirehep.net/api/literature/1234567" },
    recid: null,
    lookup: null,
  },
  {
    name: "INSPIRE address without scheme in Extra",
    fields: { extra: "inspirehep.net/literature/1234567" },
    recid: "1234567",
    lookup: null,
    changed: { recid: null, reason: EXTRA_NOT_READ },
  },
  {
    name: "link to a lookalike host in Extra",
    fields: { extra: "https://notinspirehep.net/literature/1234567" },
    recid: "1234567",
    lookup: null,
    changed: { recid: null, reason: EXTRA_NOT_READ },
  },
  {
    name: "INSPIRE link inside another link in Extra",
    fields: {
      extra:
        "https://example.org/?next=https://inspirehep.net/literature/1234567",
    },
    recid: "1234567",
    lookup: null,
    changed: { recid: null, reason: EXTRA_NOT_READ },
  },
  // ── Several sources ─────────────────────────────────────────────────────
  {
    name: "recid in Archive Location and another in the URL",
    fields: {
      archive: "INSPIRE",
      archiveLocation: "1234567",
      url: "https://inspirehep.net/literature/7654321",
    },
    recid: "1234567",
    lookup: "literature/7654321",
  },
  {
    name: "number in Archive Location (Archive empty) and a recid in the URL",
    fields: {
      archiveLocation: "1234567",
      url: "https://inspirehep.net/literature/7654321",
    },
    recid: "1234567",
    lookup: "literature/7654321",
    changed: {
      recid: "7654321",
      reason:
        "the number is not a recid (Archive is not INSPIRE), so the URL's recid is taken",
    },
  },
  {
    name: "journal DOI and recid (the lookup asks by DOI)",
    fields: {
      DOI: "10.1103/PhysRevD.100.012345",
      archive: "INSPIRE",
      archiveLocation: "1234567",
    },
    recid: "1234567",
    lookup: "doi/10.1103%2FPhysRevD.100.012345",
  },
  {
    name: "arXiv ID in Extra and recid (the lookup asks by arXiv ID)",
    fields: {
      extra: "arXiv:2301.12345 [hep-ph]",
      archive: "INSPIRE",
      archiveLocation: "1234567",
    },
    recid: "1234567",
    lookup: "arxiv/2301.12345",
  },
  {
    name: "DOI line in Extra and recid (the lookup asks by DOI)",
    fields: {
      extra: "DOI: 10.1007/JHEP01(2020)001",
      archive: "INSPIRE",
      archiveLocation: "1234567",
    },
    recid: "1234567",
    lookup: "doi/10.1007%2FJHEP01(2020)001",
  },
];

describe("recid of an item", () => {
  it.each(ROWS)("deriveRecidFromItem: $name", (row) => {
    expect(deriveRecidFromItem(fakeItem(row.fields))).toBe(now(row, "recid"));
  });

  it.each(ROWS)("INSPIRE lookup: $name", async (row) => {
    expect(await lookupPath(row.fields)).toBe(now(row, "lookup"));
  });

  it("lists only results that changed", () => {
    for (const row of ROWS) {
      const { reason, ...changed } = row.changed ?? { reason: "" };
      for (const key of Object.keys(changed) as (keyof Results)[]) {
        expect(changed[key], `${row.name}: ${key}`).not.toEqual(row[key]);
      }
    }
  });
});

describe("recid found on INSPIRE for an item without one", () => {
  it("is asked for again after the item changes", async () => {
    recidLookupCache.clear();
    vi.mocked(inspireFetch).mockResolvedValue({
      status: 200,
      json: async () => ({ metadata: { control_number: 1234567 } }),
    } as any);
    const item = { ...fakeItem({ extra: "arXiv:2301.12345" }), id: 31 };

    expect(await fetchRecidFromInspire(item)).toBe("1234567");
    expect(await fetchRecidFromInspire(item)).toBe("1234567");
    expect(inspireFetch).toHaveBeenCalledTimes(1);

    // An edit of the item (its arXiv ID, say) reaches the plugin's observer.
    // Intentional change: before, the recid found first was kept (1 request).
    await hooks.onNotify("modify", "item", [31], {});
    await fetchRecidFromInspire(item);
    expect(inspireFetch).toHaveBeenCalledTimes(2);
  });

  // Intentional change: before, the answer to the old identifiers was
  // returned and kept for the item
  it("is asked for again when the item changes while INSPIRE answers", async () => {
    recidLookupCache.clear();
    const fields: Fields = { extra: "arXiv:2301.12345" };
    const item = { ...fakeItem(fields), id: 32 };
    const answers: Array<(recid: number) => void> = [];
    vi.mocked(inspireFetch).mockImplementation(
      () =>
        new Promise((resolve) =>
          answers.push((recid) =>
            resolve({
              status: 200,
              json: async () => ({ metadata: { control_number: recid } }),
            } as any),
          ),
        ),
    );

    const lookup = fetchRecidFromInspire(item);
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    // The user corrects the arXiv ID before INSPIRE answers
    fields.extra = "arXiv:2302.54321";
    await hooks.onNotify("modify", "item", [32], {});
    answers[0](1111111);
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    expect(String(vi.mocked(inspireFetch).mock.calls[1][0])).toContain(
      "arxiv/2302.54321",
    );
    answers[1](2222222);

    expect(await lookup).toBe("2222222");
    expect(recidLookupCache.get(32)).toBe("2222222");
  });
});
