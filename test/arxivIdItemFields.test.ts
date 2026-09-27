// ─────────────────────────────────────────────────────────────────────────────
// arXiv identifiers read from Zotero item fields
//
// Fixes, for one set of field layouts, what each reader of an item's arXiv ID
// gives: preprint watch, the funding export (apiUtils), the arXiv column
// (displayed value and sort key), the INSPIRE lookup of an item without recid
// (metadataService) and the arXiv comparison of the smart update.
//
// Each row keeps what the readers gave before they switched to the shared
// field rules of arxivId.ts (the previous commit fixed those values); `changed`
// lists the intentional behaviour changes, with the new values and the reason.
// Preprint watch and the funding export now both use arxivIdFromItem.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/prefs", () => ({
  getPref: vi.fn(),
}));
vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: vi.fn(),
}));

import { getPref } from "../src/utils/prefs";
import { inspireFetch } from "../src/modules/inspire/rateLimiter";
import { arxivIdFromItem } from "../src/modules/arxiv/arxivId";
import { registerInspireItemTreeColumns } from "../src/modules/inspire/itemTreeColumns";
import { getInspireMeta } from "../src/modules/inspire/metadataService";
import { compareItemWithInspire } from "../src/modules/inspire/smartUpdate";

type Fields = Record<string, string>;

let nextItemID = 1;
function fakeItem(fields: Fields, itemType = "journalArticle"): any {
  const id = nextItemID++;
  return {
    id,
    libraryID: 1,
    itemType,
    deleted: false,
    getField: (field: string) => fields[field] ?? "",
    getCreators: () => [],
  };
}

const columnProviders: Record<string, (item: any) => string> = {};

beforeAll(async () => {
  (globalThis as any).Zotero = {
    debug: vi.fn(),
    ItemTreeManager: {
      registerColumn: vi.fn(async (options: any) => {
        columnProviders[options.dataKey] = options.dataProvider;
        return options.dataKey;
      }),
      unregisterColumn: vi.fn(),
      refreshColumns: vi.fn(),
      isCustomColumn: vi.fn(() => true),
    },
  };
  await registerInspireItemTreeColumns();
});

beforeEach(() => {
  vi.mocked(getPref).mockReset();
  vi.mocked(inspireFetch).mockReset();
  vi.mocked(inspireFetch).mockResolvedValue({ status: 404 } as any);
});

/** The arXiv column's cell value: "<sort key>\t<displayed ID>", or "" */
function arxivColumnValue(fields: Fields): string {
  return columnProviders.zinspireArxiv(fakeItem(fields));
}

/** The INSPIRE API path an item without recid is looked up by, or null */
async function inspireLookupPath(fields: Fields): Promise<string | null> {
  vi.mocked(inspireFetch).mockClear();
  await getInspireMeta(fakeItem(fields), "literatureLookup");
  const calls = vi.mocked(inspireFetch).mock.calls;
  if (calls.length === 0) return null;
  const url = String(calls[0][0]);
  return url
    .replace(/^https:\/\/inspirehep\.net\/api\//, "")
    .replace(/\?.*$/, "");
}

/** The smart update's arXiv difference, as its local value, or "no change" */
function smartUpdateArxivLocal(
  fields: Fields,
  inspireArxiv: string,
): string | null | "no change" {
  vi.mocked(getPref).mockReturnValue(false);
  const diff = compareItemWithInspire(fakeItem({ title: "T", ...fields }), {
    title: "T",
    arxiv: { value: inspireArxiv, categories: ["hep-ph"] },
  } as any);
  const change = diff.changes.find((c) => c.field === "arXiv");
  return change ? (change.localValue as string | null) : "no change";
}

// ─────────────────────────────────────────────────────────────────────────────
// Field layouts. Each row: fields, then what the code gave before the switch
// for preprint watch / funding export / arXiv column / INSPIRE lookup path.
// ─────────────────────────────────────────────────────────────────────────────

interface Results {
  preprintWatch: string | null;
  apiUtils: string | undefined;
  column: string;
  lookup: string | null;
}

interface Row extends Results {
  name: string;
  fields: Fields;
  /** Intentional behaviour changes: the new results and their reason */
  changed?: Partial<Results> & { reason: string };
}

/** What a reader gives now: the changed value if any, else the old one */
function now<K extends keyof Results>(row: Row, key: K): Results[K] {
  return row.changed && key in row.changed
    ? (row.changed[key] as Results[K])
    : row[key];
}

const ROWS: Row[] = [
  {
    name: "Extra arXiv line with category (plugin and arXiv translator layout)",
    fields: { extra: "arXiv:2301.12345 [hep-ph]" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345",
  },
  {
    name: "Extra arXiv line among other lines",
    fields: {
      extra:
        "Citation Key: Doe:2023abc\narXiv:2301.12345 [hep-ph]\n12 citations (INSPIRE 2026/9/1)",
    },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345",
  },
  {
    name: "Extra arXiv line with version",
    fields: { extra: "arXiv:2301.12345v2" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345v2",
    changed: {
      lookup: "arxiv/2301.12345",
      reason:
        "the INSPIRE lookup drops the version (INSPIRE has no record for 2301.12345v2)",
    },
  },
  {
    name: "Extra arXiv line with a space after the colon",
    fields: { extra: "arXiv: 2301.12345" },
    preprintWatch: null,
    apiUtils: "2301.12345",
    column: "",
    lookup: "arxiv/2301.12345",
    changed: {
      preprintWatch: "2301.12345",
      column: "20230112345\t2301.12345",
      reason: "every reader accepts a space after arXiv:",
    },
  },
  {
    name: "Extra _eprint line",
    fields: { extra: "_eprint: 2301.12345" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: "arxiv/2301.12345",
    changed: {
      preprintWatch: "2301.12345",
      apiUtils: "2301.12345",
      column: "20230112345\t2301.12345",
      reason: "every reader reads _eprint lines",
    },
  },
  {
    name: "Extra old-style ID",
    fields: { extra: "arXiv:hep-ph/0101001" },
    preprintWatch: "hep-ph/0101001",
    apiUtils: "hep-ph/0101001",
    column: "20010100001\thep-ph/0101001",
    lookup: "arxiv/hep-ph%2F0101001",
  },
  {
    name: "Extra old-style ID with subject class",
    fields: { extra: "arXiv:math.GT/0309136" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: "arxiv/math.GT%2F0309136",
    changed: {
      preprintWatch: "math/0309136",
      apiUtils: "math/0309136",
      column: "20030900136\tmath/0309136",
      lookup: "arxiv/math%2F0309136",
      reason: "math.GT/0309136 is math/0309136",
    },
  },
  {
    name: "Extra arXiv text not at the start of a line",
    fields: { extra: "Report number: arXiv:2301.12345" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345",
    changed: {
      preprintWatch: null,
      apiUtils: undefined,
      column: "",
      lookup: null,
      reason:
        "only lines starting with arXiv:, _eprint: or DOI: 10.48550/arXiv. count",
    },
  },
  {
    name: "Extra upper-case prefix",
    fields: { extra: "ARXIV:2301.12345" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: null,
    changed: {
      lookup: "arxiv/2301.12345",
      reason:
        "the INSPIRE lookup reads the prefix in any case, like the other readers",
    },
  },
  {
    name: "Extra truncated ID",
    fields: { extra: "arXiv:2301.1" },
    preprintWatch: "2301.1",
    apiUtils: "2301.1",
    column: "00000023011\t2301.1",
    lookup: "arxiv/2301.1",
    changed: {
      preprintWatch: null,
      apiUtils: undefined,
      column: "",
      lookup: null,
      reason: "not an arXiv identifier",
    },
  },
  {
    name: "Extra four-digit number after 2014",
    fields: { extra: "arXiv:1501.0123" },
    preprintWatch: "1501.0123",
    apiUtils: "1501.0123",
    column: "20150100123\t1501.0123",
    lookup: "arxiv/1501.0123",
    changed: {
      preprintWatch: null,
      apiUtils: undefined,
      column: "",
      lookup: null,
      reason: "not an arXiv identifier",
    },
  },
  {
    name: "Extra impossible month",
    fields: { extra: "arXiv:2313.12345" },
    preprintWatch: "2313.12345",
    apiUtils: "2313.12345",
    column: "20231312345\t2313.12345",
    lookup: "arxiv/2313.12345",
    changed: {
      preprintWatch: null,
      apiUtils: undefined,
      column: "",
      lookup: null,
      reason: "not an arXiv identifier",
    },
  },
  {
    name: "Extra arXiv DOI line",
    fields: { extra: "DOI: 10.48550/arXiv.2301.12345" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: "doi/10.48550%2FarXiv.2301.12345",
    changed: {
      preprintWatch: "2301.12345",
      apiUtils: "2301.12345",
      column: "20230112345\t2301.12345",
      lookup: "arxiv/2301.12345",
      reason:
        "an arXiv DOI line names the paper (INSPIRE finds no record by arXiv DOI)",
    },
  },
  {
    name: "Journal abbreviation (legacy layout)",
    fields: { journalAbbreviation: "arXiv:2301.12345 [hep-ph]" },
    preprintWatch: "2301.12345",
    apiUtils: undefined,
    column: "20230112345\t2301.12345",
    lookup: null,
    changed: {
      apiUtils: "2301.12345",
      reason: "the funding export reads the same fields as preprint watch",
    },
  },
  {
    name: "Journal abbreviation and Extra disagree",
    fields: {
      journalAbbreviation: "arXiv:2301.12345 [hep-ph]",
      extra: "arXiv:2302.00001 [hep-th]",
    },
    preprintWatch: "2301.12345",
    apiUtils: "2302.00001",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2302.00001",
    changed: {
      preprintWatch: "2302.00001",
      column: "20230200001\t2302.00001",
      reason: "Extra is read before Journal Abbr",
    },
  },
  {
    name: "URL abs page with version",
    fields: { url: "https://arxiv.org/abs/2301.12345v2" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345",
  },
  {
    name: "URL pdf page",
    fields: { url: "https://arxiv.org/pdf/2301.12345" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: null,
    changed: {
      preprintWatch: "2301.12345",
      apiUtils: "2301.12345",
      column: "20230112345\t2301.12345",
      lookup: "arxiv/2301.12345",
      reason: "pdf pages count like abs pages",
    },
  },
  {
    name: "URL pdf file with version",
    fields: { url: "https://arxiv.org/pdf/2301.12345v2.pdf" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: null,
    changed: {
      preprintWatch: "2301.12345",
      apiUtils: "2301.12345",
      column: "20230112345\t2301.12345",
      lookup: "arxiv/2301.12345",
      reason: "pdf pages count like abs pages",
    },
  },
  {
    name: "URL on export.arxiv.org",
    fields: { url: "http://export.arxiv.org/abs/2301.12345" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345",
  },
  {
    name: "URL on www.arxiv.org",
    fields: { url: "https://www.arxiv.org/abs/2301.12345" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345",
  },
  {
    name: "URL with a query string",
    fields: { url: "https://arxiv.org/abs/2301.12345?context=hep-ph" },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "arxiv/2301.12345",
  },
  {
    name: "URL old-style ID with version",
    fields: { url: "https://arxiv.org/abs/hep-ph/0101001v1" },
    preprintWatch: "hep-ph/0101001",
    apiUtils: "hep-ph/0101001",
    column: "20010100001\thep-ph/0101001",
    lookup: "arxiv/hep-ph%2F0101001",
  },
  {
    name: "URL old-style ID with subject class",
    fields: { url: "https://arxiv.org/abs/math.GT/0309136" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: "arxiv/math.GT%2F0309136",
    changed: {
      preprintWatch: "math/0309136",
      apiUtils: "math/0309136",
      column: "20030900136\tmath/0309136",
      lookup: "arxiv/math%2F0309136",
      reason: "math.GT/0309136 is math/0309136",
    },
  },
  {
    name: "Archive ID (arXiv translator preprint layout)",
    fields: { archiveID: "arXiv:2301.12345" },
    preprintWatch: "2301.12345",
    apiUtils: undefined,
    column: "20230112345\t2301.12345",
    lookup: null,
    changed: {
      apiUtils: "2301.12345",
      reason: "the funding export reads the same fields as preprint watch",
    },
  },
  {
    name: "arXiv DOI",
    fields: { DOI: "10.48550/arXiv.2301.12345" },
    preprintWatch: "2301.12345",
    apiUtils: undefined,
    column: "20230112345\t2301.12345",
    lookup: null,
    changed: {
      apiUtils: "2301.12345",
      reason: "the funding export reads the same fields as preprint watch",
    },
  },
  {
    name: "arXiv DOI of an old-style ID",
    fields: { DOI: "10.48550/arXiv.hep-ph/0101001" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: null,
    changed: {
      preprintWatch: "hep-ph/0101001",
      apiUtils: "hep-ph/0101001",
      column: "20010100001\thep-ph/0101001",
      reason: "arXiv DOIs of old-style identifiers are read",
    },
  },
  {
    name: "Archive Location with arXiv prefix",
    fields: { archiveLocation: "arXiv:2301.12345" },
    preprintWatch: null,
    apiUtils: "2301.12345",
    column: "",
    lookup: null,
    changed: {
      preprintWatch: "2301.12345",
      column: "20230112345\t2301.12345",
      reason: "every reader reads Archive Location marked as arXiv",
    },
  },
  {
    name: "Archive Location with Archive arXiv",
    fields: { archive: "arXiv", archiveLocation: "2301.12345" },
    preprintWatch: null,
    apiUtils: "2301.12345",
    column: "",
    lookup: "literature/2301.12345",
    changed: {
      preprintWatch: "2301.12345",
      column: "20230112345\t2301.12345",
      reason: "every reader reads Archive Location marked as arXiv",
    },
  },
  {
    name: "INSPIRE recid in Archive Location",
    fields: { archive: "INSPIRE", archiveLocation: "1234567" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: "literature/1234567",
  },
  {
    name: "Journal DOI and Extra arXiv line",
    fields: {
      DOI: "10.1103/PhysRevD.100.012345",
      extra: "arXiv:2301.12345 [hep-ph]",
    },
    preprintWatch: "2301.12345",
    apiUtils: "2301.12345",
    column: "20230112345\t2301.12345",
    lookup: "doi/10.1103%2FPhysRevD.100.012345",
  },
  {
    name: "No identifier",
    fields: { title: "A paper" },
    preprintWatch: null,
    apiUtils: undefined,
    column: "",
    lookup: null,
  },
];

describe("arXiv ID read from item fields", () => {
  it.each(ROWS)("preprint watch: $name", (row) => {
    expect(arxivIdFromItem(fakeItem(row.fields))).toBe(
      now(row, "preprintWatch"),
    );
  });

  it.each(ROWS)("funding export: $name", (row) => {
    expect(arxivIdFromItem(fakeItem(row.fields)) ?? undefined).toBe(
      now(row, "apiUtils"),
    );
  });

  it.each(ROWS)("arXiv column: $name", (row) => {
    expect(arxivColumnValue(row.fields)).toBe(now(row, "column"));
  });

  it.each(ROWS)("INSPIRE lookup: $name", async (row) => {
    expect(await inspireLookupPath(row.fields)).toBe(now(row, "lookup"));
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

describe("arXiv column sort order", () => {
  it("orders items by the date and number of their arXiv ID", () => {
    const ids = [
      "arXiv:2301.12345",
      "arXiv:hep-th/9802109",
      "arXiv:1501.00001",
      "arXiv:0704.0001",
      "arXiv:hep-ph/0610008",
      "arXiv:1412.9999",
    ];
    const sorted = ids
      .map((extra) => arxivColumnValue({ extra }))
      .sort()
      .map((value) => value.split("\t")[1]);
    expect(sorted).toEqual([
      "hep-th/9802109",
      "hep-ph/0610008",
      "0704.0001",
      "1412.9999",
      "1501.00001",
      "2301.12345",
    ]);
  });
});

describe("smart update: arXiv difference", () => {
  it.each([
    ["arXiv:2301.12345 [hep-ph]", "2301.12345", "no change"],
    ["arXiv:hep-ph/0101001", "hep-ph/0101001", "no change"],
    ["arXiv:2301.12345 [hep-ph]", "2302.00001", "2301.12345"],
    ["", "2301.12345", null],
    ["ARXIV:2301.12345", "2301.12345", "no change"],
  ])("Extra %j vs INSPIRE %j -> %j", (extra, inspire, expected) => {
    expect(smartUpdateArxivLocal({ extra }, inspire)).toBe(expected);
  });

  // Intentional changes: the identifiers are compared, not their notation
  it.each([
    ["arXiv:2301.12345v2", "2301.12345", "2301.12345v2", "no change"],
    ["arXiv: 2301.12345", "2301.12345", null, "no change"],
    ["_eprint: 2301.12345", "2301.12345", null, "no change"],
    ["arXiv:math.GT/0309136", "math/0309136", "math.GT/0309136", "no change"],
    // only lines that start with the prefix count; a malformed ID is none
    ["Report number: arXiv:2301.12345", "2301.12345", "no change", null],
    ["arXiv:2301.1", "2301.12345", "2301.1", null],
    // INSPIRE never returns an impossible number such as 1234.5678 (month 34)
    ["arXiv:1234.5678 [hep-ph]", "1234.5678", "no change", null],
  ])(
    "Extra %j vs INSPIRE %j -> %j before -> %j after",
    (extra, inspire, _before, after) => {
      expect(smartUpdateArxivLocal({ extra }, inspire)).toBe(after);
    },
  );
});
