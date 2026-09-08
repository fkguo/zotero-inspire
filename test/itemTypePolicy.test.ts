// ─────────────────────────────────────────────────────────────────────────────
// itemTypePolicy.test.ts - Item type conversion after an INSPIRE match
// Issue #7: optionally keep Preprint items as Preprint until published.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  resolveInspireItemType,
  policyFromPrefs,
  hasJournalPublicationInfo,
  isBookRecord,
} from "../src/modules/inspire/itemTypePolicy";

const CONVERT = { keepPreprintType: false };
const KEEP = { keepPreprintType: true };

const unpublished = {
  arxiv: { value: "2301.12345" },
  document_type: ["article"],
};
const published = {
  journalAbbreviation: "Phys. Rev. D",
  volume: "108",
  document_type: ["article"],
};
const book = { document_type: ["book"] };

describe("policyFromPrefs", () => {
  it("keeps preprint type only when the pref is on and legacy is off", () => {
    expect(policyFromPrefs(true, false)).toEqual({ keepPreprintType: true });
    expect(policyFromPrefs(true, undefined)).toEqual({
      keepPreprintType: true,
    });
  });

  it("is off by default and whenever the legacy Journal Abbr. option is on", () => {
    expect(policyFromPrefs(false, false)).toEqual({ keepPreprintType: false });
    expect(policyFromPrefs(undefined, undefined)).toEqual({
      keepPreprintType: false,
    });
    expect(policyFromPrefs(true, true)).toEqual({ keepPreprintType: false });
  });
});

describe("hasJournalPublicationInfo / isBookRecord", () => {
  it("detects journal info from a non-empty journalAbbreviation", () => {
    expect(hasJournalPublicationInfo(published)).toBe(true);
    expect(hasJournalPublicationInfo(unpublished)).toBe(false);
    expect(hasJournalPublicationInfo({ journalAbbreviation: "" })).toBe(false);
    expect(hasJournalPublicationInfo({ journalAbbreviation: "   " })).toBe(
      false,
    );
  });

  it("matches the historical loose document_type == 'book' comparison", () => {
    expect(isBookRecord({ document_type: ["book"] })).toBe(true);
    expect(isBookRecord({ document_type: "book" })).toBe(true);
    expect(isBookRecord({ document_type: ["book", "proceedings"] })).toBe(
      false,
    );
    expect(isBookRecord({ document_type: ["article"] })).toBe(false);
    expect(isBookRecord({})).toBe(false);
  });
});

describe("resolveInspireItemType — historical behaviour (option off)", () => {
  it("always converts preprint and report to journalArticle", () => {
    expect(resolveInspireItemType("preprint", unpublished, CONVERT)).toBe(
      "journalArticle",
    );
    expect(resolveInspireItemType("preprint", published, CONVERT)).toBe(
      "journalArticle",
    );
    expect(resolveInspireItemType("report", unpublished, CONVERT)).toBe(
      "journalArticle",
    );
  });

  it("leaves journalArticle and other types alone", () => {
    expect(resolveInspireItemType("journalArticle", published, CONVERT)).toBe(
      null,
    );
    expect(resolveInspireItemType("journalArticle", unpublished, CONVERT)).toBe(
      null,
    );
    expect(resolveInspireItemType("conferencePaper", published, CONVERT)).toBe(
      null,
    );
    expect(resolveInspireItemType("thesis", unpublished, CONVERT)).toBe(null);
  });

  it("converts anything that is not a book into book for book records", () => {
    expect(resolveInspireItemType("journalArticle", book, CONVERT)).toBe(
      "book",
    );
    expect(resolveInspireItemType("preprint", book, CONVERT)).toBe("book");
    expect(resolveInspireItemType("book", book, CONVERT)).toBe(null);
  });
});

describe("resolveInspireItemType — keep preprint type (option on)", () => {
  it("keeps an unpublished preprint or report as it is", () => {
    expect(resolveInspireItemType("preprint", unpublished, KEEP)).toBe(null);
    expect(resolveInspireItemType("report", unpublished, KEEP)).toBe(null);
    expect(resolveInspireItemType("preprint", {}, KEEP)).toBe(null);
  });

  it("converts to journalArticle once INSPIRE reports a journal publication", () => {
    expect(resolveInspireItemType("preprint", published, KEEP)).toBe(
      "journalArticle",
    );
    expect(resolveInspireItemType("report", published, KEEP)).toBe(
      "journalArticle",
    );
  });

  it("still converts book records to book", () => {
    expect(resolveInspireItemType("preprint", book, KEEP)).toBe("book");
    expect(resolveInspireItemType("journalArticle", book, KEEP)).toBe("book");
  });

  it("does not touch items that are already journalArticle", () => {
    expect(resolveInspireItemType("journalArticle", unpublished, KEEP)).toBe(
      null,
    );
    expect(resolveInspireItemType("journalArticle", published, KEEP)).toBe(
      null,
    );
  });
});
