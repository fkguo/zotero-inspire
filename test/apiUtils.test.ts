// ─────────────────────────────────────────────────────────────────────────────
// apiUtils.test.ts - Identifier extraction from Zotero items and INSPIRE links
//
// Regression cases:
//   - repository record URLs (CDS, DESY pubdb, RERO, NII) were read as INSPIRE
//     recids, so the panel showed another paper's references and citations
//     (URLs below are taken from real library items);
//   - a reference linked to an INSPIRE data record got that record's number
//     as a literature recid;
//   - an INSPIRE recid in Archive Location was returned as an arXiv ID.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  deriveRecidFromItem,
  extractArxivIdFromItem,
  extractRecidFromRecordRef,
  extractRecidFromUrl,
  extractRecidFromUrls,
} from "../src/modules/inspire/apiUtils";

// Fields that do not exist for a type read back as "" (Zotero getField).
function fakeItem(fields: Record<string, string> = {}): any {
  return {
    id: 1,
    itemType: "journalArticle",
    getField: (field: string) => fields[field] ?? "",
  };
}

const REPOSITORY_RECORD_URLS = [
  "https://cds.cern.ch/record/1986460",
  "http://cds.cern.ch/record/352337",
  "https://cds.cern.ch/record/160509/files/198507092.pdf",
  "http://cdsweb.cern.ch/record/1234567",
  "https://bib-pubdb1.desy.de/record/322571/files/PhysRevLett.24.792.pdf",
  "https://doc.rero.ch/record/31960/files/kno_psm.pdf",
  "https://nifs-repository.repo.nii.ac.jp/record/321/files/2169%20PhysPlasmas_7_466.pdf",
];

describe("extractRecidFromUrl", () => {
  it.each(REPOSITORY_RECORD_URLS)("gives no recid for %s", (url) => {
    expect(extractRecidFromUrl(url)).toBeNull();
  });

  it.each([
    ["https://inspirehep.net/literature/1840386", "1840386"],
    ["https://www.inspirehep.net/literature/1840386", "1840386"],
    ["https://inspirehep.net/api/literature/123", "123"],
    ["https://www.inspirehep.net/api/literature/123", "123"],
    ["http://inspirehep.net/record/123", "123"],
    ["http://www.inspirehep.net/record/123", "123"],
    ["http://inspirehep.net/record/230779/", "230779"],
    ["https://inspirehep.net/literature/123/", "123"],
    ["https://inspirehep.net/literature/123?ui-citation-summary=true", "123"],
    ["https://inspirehep.net/api/literature/123?format=json", "123"],
    ["https://inspirehep.net/literature/123#references", "123"],
    ["http://inspirehep.net/record/123/export/hx", "123"],
    ["https://InspireHEP.net/literature/123", "123"],
    ["https://inspirehep.net:443/api/literature/123", "123"],
    ["//inspirehep.net/literature/123", "123"],
    [" https://inspirehep.net/literature/123 ", "123"],
  ])("reads the recid from %j", (url, recid) => {
    expect(extractRecidFromUrl(url)).toBe(recid);
  });

  it.each([
    // other INSPIRE collections and searches are not literature records
    "https://inspirehep.net/authors/1012345",
    "https://inspirehep.net/literature?q=recid:123",
    // the digit run must end the path segment; the URL parser would read a
    // backslash as "/" and drop a line break
    "https://inspirehep.net/literature/123abc",
    "https://inspirehep.net/record/123abc",
    "https://inspirehep.net/literature/123\\abc",
    "https://inspirehep.net/literature/12\n3",
    // a single link with a space in it is broken, not two links
    "https://inspirehep.net/literature/12 3",
    // lookalike hosts and INSPIRE links embedded in another URL
    "https://inspirehep.net.example.org/literature/123",
    "https://inspirehep.net@example.org/literature/123",
    "https://example.org/inspirehep.net/literature/123",
    "https://example.org/?next=https://inspirehep.net/literature/123",
    "https://example.org/literature/123",
    // links without a host cannot be attributed to INSPIRE
    "/api/literature/123",
    "/literature/123",
    "literature/123",
    "inspirehep.net/literature/123",
    "www.inspirehep.net/literature/123",
  ])("gives no recid for %j", (url) => {
    expect(extractRecidFromUrl(url)).toBeNull();
  });

  it("handles empty and non-text input", () => {
    expect(extractRecidFromUrl("")).toBeNull();
    expect(extractRecidFromUrl(null)).toBeNull();
    expect(extractRecidFromUrl(undefined)).toBeNull();
    expect(extractRecidFromUrl(123 as any)).toBeNull();
  });
});

describe("extractRecidFromRecordRef", () => {
  it.each([
    ["https://inspirehep.net/api/literature/230779", "230779"],
    ["https://inspirehep.net/api/literature/230779?format=json", "230779"],
    // a relative $ref is resolved against INSPIRE, which issued it
    ["/api/literature/230779", "230779"],
  ])("reads the recid from %s", (ref, recid) => {
    expect(extractRecidFromRecordRef(ref)).toBe(recid);
  });

  it.each([
    // a reference linked to an INSPIRE data record, as returned by the API
    "https://inspirehep.net/api/data/2875713",
    "https://inspirehep.net/api/authors/1012345",
    "https://cds.cern.ch/record/1986460",
    "//cds.cern.ch/record/1986460",
  ])("gives no recid for %s", (ref) => {
    expect(extractRecidFromRecordRef(ref)).toBeNull();
  });

  it("handles empty and non-text input", () => {
    expect(extractRecidFromRecordRef("")).toBeNull();
    expect(extractRecidFromRecordRef(undefined)).toBeNull();
    expect(extractRecidFromRecordRef(123 as any)).toBeNull();
  });
});

describe("extractRecidFromUrls", () => {
  it("skips repository record URLs and takes the INSPIRE link", () => {
    expect(
      extractRecidFromUrls([
        { value: "http://cdsweb.cern.ch/record/1234567" },
        { value: "http://inspirehep.net/record/230779/" },
      ]),
    ).toBe("230779");
  });

  it("gives no recid when only repository record URLs are present", () => {
    expect(
      extractRecidFromUrls([{ value: "https://cds.cern.ch/record/1986460" }]),
    ).toBeNull();
    expect(extractRecidFromUrls([])).toBeNull();
    expect(extractRecidFromUrls(undefined)).toBeNull();
  });

  it("treats each value as one link", () => {
    expect(
      extractRecidFromUrls([
        { value: "https://inspirehep.net/literature/12 3" },
      ]),
    ).toBeNull();
  });

  it("skips a malformed entry without failing", () => {
    expect(
      extractRecidFromUrls([
        { value: 123 as any },
        { value: "https://inspirehep.net/literature/5" },
      ]),
    ).toBe("5");
  });
});

describe("deriveRecidFromItem", () => {
  it.each(REPOSITORY_RECORD_URLS)(
    "gives no recid for an item whose URL is %s",
    (url) => {
      expect(deriveRecidFromItem(fakeItem({ url }))).toBeNull();
    },
  );

  it("gives no recid when Archive Location is not a recid and nothing else points to INSPIRE", () => {
    expect(
      deriveRecidFromItem(
        fakeItem({
          archiveLocation: "CERN-TH-4321",
          url: "https://cds.cern.ch/record/1986460",
        }),
      ),
    ).toBeNull();
  });

  it("reads the recid from an INSPIRE URL", () => {
    expect(
      deriveRecidFromItem(
        fakeItem({ url: "https://inspirehep.net/literature/1705780" }),
      ),
    ).toBe("1705780");
  });

  // Zotero's URL field holds one link; anything else is not read as a list
  it.each([
    "https://inspirehep.net/literature/123\nhttps://arxiv.org/abs/2301.12345",
    "https://inspirehep.net/literature/12\n3",
    "https://inspirehep.net/literature/12 3",
  ])("gives no recid for a URL field that is not one link: %j", (url) => {
    expect(deriveRecidFromItem(fakeItem({ url }))).toBeNull();
  });

  it("prefers a numeric Archive Location over the URL", () => {
    expect(
      deriveRecidFromItem(
        fakeItem({
          archive: "INSPIRE",
          archiveLocation: "2815336",
          url: "http://cds.cern.ch/record/2815336",
        }),
      ),
    ).toBe("2815336");
  });

  it("falls back to an INSPIRE link in Extra when the URL is a repository record", () => {
    expect(
      deriveRecidFromItem(
        fakeItem({
          url: "https://cds.cern.ch/record/1986460",
          extra: "See https://inspirehep.net/literature/1234567",
        }),
      ),
    ).toBe("1234567");
  });
});

describe("extractArxivIdFromItem (apiUtils)", () => {
  it("does not read an INSPIRE recid in Archive Location as an arXiv ID", () => {
    expect(
      extractArxivIdFromItem(
        fakeItem({ archive: "INSPIRE", archiveLocation: "1234567" }),
      ),
    ).toBeUndefined();
    expect(
      extractArxivIdFromItem(fakeItem({ archiveLocation: "1234567" })),
    ).toBeUndefined();
  });

  it("requires an arXiv marker even when Archive Location looks like an arXiv ID", () => {
    expect(
      extractArxivIdFromItem(
        fakeItem({ archive: "INSPIRE", archiveLocation: "2101.01234" }),
      ),
    ).toBeUndefined();
  });

  it.each([
    ["arXiv:2101.01234", "2101.01234"],
    ["arXiv: 2101.01234", "2101.01234"],
    ["arXiv:2101.01234v2", "2101.01234"],
    ["ARXIV:0704.0001", "0704.0001"],
    ["arXiv:1412.9999", "1412.9999"],
    ["arXiv:1501.00001", "1501.00001"],
    ["arXiv:hep-ph/0001234", "hep-ph/0001234"],
    ["arXiv:hep-th/9108001", "hep-th/9108001"],
    // the old scheme's documented range is 9107-0703
    ["arXiv:hep-th/9107001", "hep-th/9107001"],
    ["arXiv:math/0703001", "math/0703001"],
    // old style with a subject class (math, cs, nlin and q-bio only)
    ["arXiv:math.GT/0309136", "math.GT/0309136"],
    ["arXiv:q-bio.BM/0401004", "q-bio.BM/0401004"],
  ])("reads the ID from Archive Location %s", (archiveLocation, id) => {
    expect(extractArxivIdFromItem(fakeItem({ archiveLocation }))).toBe(id);
  });

  it("reads Archive Location when Archive is arXiv", () => {
    expect(
      extractArxivIdFromItem(
        fakeItem({ archive: "arXiv", archiveLocation: "2101.01234" }),
      ),
    ).toBe("2101.01234");
    expect(
      extractArxivIdFromItem(
        fakeItem({ archive: "ARXIV", archiveLocation: "hep-th/9901001v1" }),
      ),
    ).toBe("hep-th/9901001");
    expect(
      extractArxivIdFromItem(
        fakeItem({ archive: "arXiv", archiveLocation: "math.DG/0211159" }),
      ),
    ).toBe("math.DG/0211159");
  });

  it("rejects values that are not arXiv IDs even when marked as arXiv", () => {
    expect(
      extractArxivIdFromItem(fakeItem({ archiveLocation: "arXiv:1234567" })),
    ).toBeUndefined();
    expect(
      extractArxivIdFromItem(
        fakeItem({ archive: "arXiv", archiveLocation: "1234567" }),
      ),
    ).toBeUndefined();
    expect(
      extractArxivIdFromItem(
        fakeItem({ archive: "arXiv", archiveLocation: "hep-ph/000123" }),
      ),
    ).toBeUndefined();
    // a subject class has exactly two letters, and only math, cs, nlin and
    // q-bio identifiers carry one
    expect(
      extractArxivIdFromItem(
        fakeItem({ archiveLocation: "arXiv:math.GTX/0309136" }),
      ),
    ).toBeUndefined();
    expect(
      extractArxivIdFromItem(
        fakeItem({ archiveLocation: "arXiv:hep-ph.GT/9901001" }),
      ),
    ).toBeUndefined();
    // an archive name is letters, joined by single hyphens
    expect(
      extractArxivIdFromItem(
        fakeItem({ archiveLocation: "arXiv:---/9901001" }),
      ),
    ).toBeUndefined();
  });

  it.each([
    // impossible month or version, or a zero sequence number
    "arXiv:9913.12345",
    "arXiv:hep-ph/0013123",
    "arXiv:2301.12345v0",
    "arXiv:2101.00000",
    "arXiv:hep-ph/0001000",
    // four-digit sequence numbers ran 0704-1412, five-digit ones from 1501
    "arXiv:2301.1234",
    "arXiv:1412.00001",
    "arXiv:0703.0001",
    // old-style identifiers ran 9107-0703
    "arXiv:hep-th/9106001",
    "arXiv:hep-ph/0704001",
  ])(
    "rejects a value outside arXiv's identifier scheme: %s",
    (archiveLocation) => {
      expect(
        extractArxivIdFromItem(fakeItem({ archiveLocation })),
      ).toBeUndefined();
    },
  );

  it("still prefers Extra and URL over Archive Location", () => {
    expect(
      extractArxivIdFromItem(
        fakeItem({
          extra: "arXiv:2301.12345 [hep-ph]",
          archive: "INSPIRE",
          archiveLocation: "1234567",
        }),
      ),
    ).toBe("2301.12345");
    expect(
      extractArxivIdFromItem(
        fakeItem({
          url: "https://arxiv.org/abs/hep-ph/0001234",
          archive: "INSPIRE",
          archiveLocation: "1234567",
        }),
      ),
    ).toBe("hep-ph/0001234");
  });
});
