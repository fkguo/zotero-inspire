import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspireFetch: vi.fn(),
  readExternalReadToken: vi.fn(),
}));

vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: mocks.inspireFetch,
}));

vi.mock("../src/utils/externalToken", () => ({
  readExternalReadToken: mocks.readExternalReadToken,
}));

import { config, version } from "../package.json";
import {
  buildInspireBibtexBatch,
  extractCitationKeyFromExtra,
  findItemsByCitationKeys,
  INSPIRE_BIBTEX_API_LIMITS,
  InspireBibtexApiError,
  rewriteSingleBibtexEntryKey,
  utf8ByteLength,
  validateCitationKeys,
} from "../src/modules/inspireBibtexApi";
import {
  dispatchInspireBibtexOp,
  INSPIRE_BIBTEX_API_VERSION,
  INSPIRE_BIBTEX_ENDPOINT_PATH,
  registerZInspireBibtexEndpoint,
  unregisterZInspireBibtexEndpoint,
} from "../src/modules/connectorInspireBibtexApi";

type EndpointResult = [number, string, string];
type BbtRecord = { citationKey: string; itemID: number };

interface MockItemOptions {
  id: number;
  key?: string;
  libraryID?: number;
  deleted?: boolean;
  feed?: boolean;
  feedAsMethod?: boolean;
  regular?: boolean;
  fields?: Record<string, string>;
}

interface MockItem {
  id: number;
  key: string;
  libraryID: number;
  deleted: boolean;
  isFeedItem: boolean | ReturnType<typeof vi.fn>;
  isRegularItem: ReturnType<typeof vi.fn>;
  getField: ReturnType<typeof vi.fn>;
  setField: ReturnType<typeof vi.fn>;
  saveTx: ReturnType<typeof vi.fn>;
  trashTx: ReturnType<typeof vi.fn>;
  eraseTx: ReturnType<typeof vi.fn>;
}

interface MockBetterBibtexTranslation {
  string: unknown;
  setItems: ReturnType<typeof vi.fn>;
  setTranslator: ReturnType<typeof vi.fn>;
  setDisplayOptions: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
}

const itemsByID = new Map<number, MockItem>();
const createdItems: MockItem[] = [];
let betterBibtexAll: ReturnType<typeof vi.fn>;
let dbQueryAsync: ReturnType<typeof vi.fn>;
let zoteroTrashTx: ReturnType<typeof vi.fn>;
let linkFromFile: ReturnType<typeof vi.fn>;
let importFromFile: ReturnType<typeof vi.fn>;
let betterBibtexExportConstructor: ReturnType<typeof vi.fn>;
let betterBibtexExportOutput: unknown;
let betterBibtexExportImplementation: (
  translation: MockBetterBibtexTranslation,
) => Promise<void>;
const betterBibtexTranslations: MockBetterBibtexTranslation[] = [];

function parse(result: EndpointResult): { status: number; body: any } {
  const [status, contentType, body] = result;
  expect(contentType).toBe("application/json");
  return { status, body: JSON.parse(body) };
}

function makeItem(options: MockItemOptions): MockItem {
  const fields = options.fields ?? {};
  const item: MockItem = {
    id: options.id,
    key: options.key ?? `ITEM${options.id}`,
    libraryID: options.libraryID ?? 1,
    deleted: options.deleted ?? false,
    isFeedItem: options.feedAsMethod
      ? vi.fn(() => options.feed ?? false)
      : (options.feed ?? false),
    isRegularItem: vi.fn(() => options.regular ?? true),
    getField: vi.fn((field: string) => fields[field] ?? ""),
    setField: vi.fn(),
    saveTx: vi.fn(async () => undefined),
    trashTx: vi.fn(async () => undefined),
    eraseTx: vi.fn(async () => undefined),
  };
  itemsByID.set(item.id, item);
  createdItems.push(item);
  return item;
}

function setBetterBibtexRecords(
  records: BbtRecord[],
  ready: Promise<unknown> = Promise.resolve(),
): void {
  betterBibtexAll = vi.fn((predicate: (record: BbtRecord) => boolean) =>
    records.filter(predicate),
  );
  (Zotero as any).BetterBibTeX = {
    ready,
    KeyManager: { all: betterBibtexAll },
    Translators: {
      bySlug: {
        BetterBibTeX: { translatorID: "test-better-bibtex-translator" },
      },
    },
  };
}

function prepareBbtItem(
  citationKey: string,
  options: Omit<MockItemOptions, "id"> & { id?: number } = {},
): MockItem {
  const item = makeItem({ id: options.id ?? 1, ...options });
  setBetterBibtexRecords([{ citationKey, itemID: item.id }]);
  return item;
}

function bibtexResponse(entryKey: string, title = "INSPIRE title"): Response {
  return new Response(
    `@article{${entryKey},\n  title = {${title}},\n  year = {2026}\n}`,
    { status: 200, headers: { "Content-Type": "application/x-bibtex" } },
  );
}

function sizedBibtex(entryKey: string, targetBytes: number): string {
  const prefix = `@article{${entryKey},\n  title = {`;
  const suffix = "}\n}";
  const fixedBytes = utf8ByteLength(prefix) + utf8ByteLength(suffix);
  if (fixedBytes > targetBytes)
    throw new Error("Target BibTeX size is too small");
  return `${prefix}${"x".repeat(targetBytes - fixedBytes)}${suffix}`;
}

function setBetterBibtexExportOutput(output: unknown): void {
  betterBibtexExportOutput = output;
  betterBibtexExportImplementation = async (translation) => {
    translation.string = betterBibtexExportOutput;
  };
}

function inspireFields(
  archiveLocation: string,
  additional: Record<string, string> = {},
): Record<string, string> {
  return { archive: "INSPIRE", archiveLocation, ...additional };
}

async function waitForCondition(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function expectApiError(fn: () => unknown, code: string, status = 400): void {
  try {
    fn();
    throw new Error("Expected InspireBibtexApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(InspireBibtexApiError);
    expect(err).toMatchObject({ code, status });
  }
}

function expectNoZoteroMutations(): void {
  for (const item of createdItems) {
    expect(item.setField).not.toHaveBeenCalled();
    expect(item.saveTx).not.toHaveBeenCalled();
    expect(item.trashTx).not.toHaveBeenCalled();
    expect(item.eraseTx).not.toHaveBeenCalled();
  }
  expect(zoteroTrashTx).not.toHaveBeenCalled();
  expect(linkFromFile).not.toHaveBeenCalled();
  expect(importFromFile).not.toHaveBeenCalled();
}

function getRegisteredEndpoint(): any {
  registerZInspireBibtexEndpoint();
  const Endpoint = (Zotero as any).Server.Endpoints[
    INSPIRE_BIBTEX_ENDPOINT_PATH
  ];
  expect(Endpoint).toBeTypeOf("function");
  return new Endpoint();
}

beforeEach(() => {
  itemsByID.clear();
  createdItems.length = 0;
  mocks.inspireFetch.mockReset();
  mocks.inspireFetch.mockRejectedValue(
    new Error("Unexpected INSPIRE request in unit test"),
  );
  mocks.readExternalReadToken.mockReset();
  mocks.readExternalReadToken.mockReturnValue("READ-TOKEN");

  betterBibtexTranslations.length = 0;
  setBetterBibtexExportOutput(
    "@article{better-bibtex-generated,\n  title = {Local fallback}\n}",
  );
  betterBibtexExportConstructor = vi.fn(function () {
    const translation: MockBetterBibtexTranslation = {
      string: "",
      setItems: vi.fn(),
      setTranslator: vi.fn(),
      setDisplayOptions: vi.fn(),
      translate: vi.fn(async () => {
        await betterBibtexExportImplementation(translation);
      }),
    };
    betterBibtexTranslations.push(translation);
    return translation;
  });

  dbQueryAsync = vi.fn(async () => []);
  zoteroTrashTx = vi.fn(async () => undefined);
  linkFromFile = vi.fn(async () => undefined);
  importFromFile = vi.fn(async () => undefined);

  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    platformMajorVersion: 8,
    BetterBibTeX: undefined,
    DB: { queryAsync: dbQueryAsync },
    ItemFields: {
      getID: vi.fn((field: string) => {
        if (field === "citationKey") return 10;
        if (field === "extra") return 11;
        return false;
      }),
    },
    Items: {
      getAsync: vi.fn(async (ids: number[]) =>
        ids.map((id) => itemsByID.get(id)).filter(Boolean),
      ),
      trashTx: zoteroTrashTx,
    },
    Libraries: {
      userLibraryID: 1,
      get: vi.fn((libraryID: number) => {
        if (libraryID === 1) {
          return { libraryType: "user", name: "My Library" };
        }
        if (libraryID === 2) {
          return { libraryType: "group", name: "Theory Group" };
        }
        return { libraryType: "publications", name: "Unsupported" };
      }),
    },
    Attachments: { linkFromFile, importFromFile },
    Translate: { Export: betterBibtexExportConstructor },
    Server: { Endpoints: {} as Record<string, any> },
  });
  setBetterBibtexRecords([]);
});

afterEach(() => {
  try {
    unregisterZInspireBibtexEndpoint();
    expectNoZoteroMutations();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

describe("citation-key validation", () => {
  it("accepts batches from one through twenty exact keys", () => {
    expect(validateCitationKeys(["one"])).toEqual(["one"]);
    const twenty = Array.from({ length: 20 }, (_, index) => `key-${index}`);
    expect(validateCitationKeys(twenty)).toEqual(twenty);
  });

  it("enforces the key-count and key-length boundaries", () => {
    expect(validateCitationKeys(["x".repeat(200)])).toEqual(["x".repeat(200)]);
    expectApiError(
      () => validateCitationKeys(Array.from({ length: 21 }, (_, i) => `k${i}`)),
      "TOO_MANY_CITATION_KEYS",
    );
    expectApiError(
      () => validateCitationKeys(["x".repeat(201)]),
      "INVALID_CITATION_KEYS",
    );
    expectApiError(() => validateCitationKeys([]), "INVALID_CITATION_KEYS");
    expectApiError(
      () => validateCitationKeys("not-an-array"),
      "INVALID_CITATION_KEYS",
    );
  });

  it.each([
    " leading",
    "trailing ",
    "two words",
    'quote"key',
    "slash\\key",
    "hash#key",
    "percent%key",
    "apostrophe'key",
    "paren(key",
    "comma,key",
    "equals=key",
    "brace{key",
    "tilde~key",
    "control\u0000key",
    "delete\u007fkey",
    "c1-start\u0080key",
    "c1-next-line\u0085key",
    "c1-end\u009fkey",
  ])("rejects unsafe citation key %j", (citationKey) => {
    expectApiError(
      () => validateCitationKeys([citationKey]),
      "INVALID_CITATION_KEYS",
    );
  });

  it("accepts printable Unicode immediately above the C1 range", () => {
    expect(validateCitationKeys(["printable\u00a1key"])).toEqual([
      "printable\u00a1key",
    ]);
  });

  it("rejects exact duplicates without folding case", () => {
    expectApiError(
      () => validateCitationKeys(["CaseKey", "CaseKey"]),
      "DUPLICATE_CITATION_KEY",
    );
    expect(validateCitationKeys(["CaseKey", "casekey"])).toEqual([
      "CaseKey",
      "casekey",
    ]);
  });
});

describe("single-entry BibTeX key rewriting", () => {
  it("rewrites only the curly-brace entry key byte-for-byte", () => {
    const input =
      "@article{INSPIRE:old,\n  author = {Doe, Jane},\n  title = {A {nested} title}\n}";
    const result = rewriteSingleBibtexEntryKey(input, "CaywKey2026");
    expect(result).toEqual({
      text: "@article{CaywKey2026,\n  author = {Doe, Jane},\n  title = {A {nested} title}\n}",
      entryType: "article",
      originalEntryKey: "INSPIRE:old",
      entryKey: "CaywKey2026",
      rewritten: true,
    });
  });

  it("reports an already matching key without changing the text", () => {
    const input = "@article{SameKey,\n  title = {Untouched}\n}";
    expect(rewriteSingleBibtexEntryKey(input, "SameKey")).toEqual({
      text: input,
      entryType: "article",
      originalEntryKey: "SameKey",
      entryKey: "SameKey",
      rewritten: false,
    });
  });

  it("supports a parenthesized BibTeX entry", () => {
    const input = "@inproceedings ( old-key ,\n  title = {Proceedings}\n)";
    const result = rewriteSingleBibtexEntryKey(input, "new-key");
    expect(result.text).toBe(
      "@inproceedings ( new-key ,\n  title = {Proceedings}\n)",
    );
    expect(result.originalEntryKey).toBe("old-key");
  });

  it.each([
    "@article{old-key,\n  url = {https://example.org/a%20b}\n}",
    "@article(old-key,\n  url = {https://example.org/a%20b}\n)",
  ])("preserves percent escapes inside braced field values", (input) => {
    const result = rewriteSingleBibtexEntryKey(input, "requested-key");
    expect(result.text).toBe(input.replace("old-key", "requested-key"));
  });

  it("ignores auxiliary comment, preamble, and string blocks", () => {
    const input = [
      "@comment{comment-key, note = {metadata}}",
      "@preamble{preamble-key, note = {metadata}}",
      "@string{string-key, note = {metadata}}",
      "@book{source-key,\n  title = {The Book}\n}",
    ].join("\n\n");
    const result = rewriteSingleBibtexEntryKey(input, "requested-key");
    expect(result.text).toBe(
      input.replace("@book{source-key,", "@book{requested-key,"),
    );
    expect(result.originalEntryKey).toBe("source-key");
  });

  it("does not count an entry-shaped fragment nested inside a comment", () => {
    const input = [
      "@comment{This text mentions @article{fake-key, title={Not data}}}",
      "@article{real-key,\n  title = {Real data}\n}",
    ].join("\n\n");
    const result = rewriteSingleBibtexEntryKey(input, "requested-key");
    expect(result.originalEntryKey).toBe("real-key");
    expect(result.text).toBe(
      input.replace("@article{real-key,", "@article{requested-key,"),
    );
  });

  it("rejects zero or multiple data entries", () => {
    expectApiError(
      () => rewriteSingleBibtexEntryKey("@comment{only, note={x}}", "key"),
      "INSPIRE_BIBTEX_INVALID",
      502,
    );
    expectApiError(
      () =>
        rewriteSingleBibtexEntryKey(
          "@article{one, title={1}}\n@book{two, title={2}}",
          "key",
        ),
      "INSPIRE_BIBTEX_INVALID",
      502,
    );
    expectApiError(
      () => rewriteSingleBibtexEntryKey("   ", "key"),
      "INSPIRE_BIBTEX_INVALID",
      502,
    );
  });
});

describe("Better BibTeX citation keys stored in Extra", () => {
  it.each([
    ["Citation Key: Alpha", "Alpha"],
    ["Citation-Key: Beta", "Beta"],
    ["CitationKey: Gamma", "Gamma"],
    ["BibTeX: Delta", "Delta"],
    ["cItAtIoN kEy: MixedCaseLabel", "MixedCaseLabel"],
  ])("parses supported label %j", (extra, expected) => {
    expect(extractCitationKeyFromExtra(extra)).toBe(expected);
  });

  it("handles CRLF and uses the last matching line", () => {
    expect(
      extractCitationKeyFromExtra(
        "Citation Key: Old\r\nDOI: 10.1000/example\r\nBibTeX: Final",
      ),
    ).toBe("Final");
  });

  it("lets a final empty label clear an earlier value", () => {
    expect(
      extractCitationKeyFromExtra("Citation Key: Old\nCitation-Key:   "),
    ).toBeNull();
    expect(extractCitationKeyFromExtra("Citation Key:")).toBeNull();
    expect(extractCitationKeyFromExtra(42)).toBeNull();
    expect(extractCitationKeyFromExtra("")).toBeNull();
  });
});

describe("citation-key resolution", () => {
  it("waits for Better BibTeX and treats KeyManager.all as authoritative", async () => {
    const current = makeItem({
      id: 1,
      fields: { extra: "Citation Key: ObsoleteKey" },
    });
    makeItem({
      id: 2,
      fields: { extra: "Citation Key: CurrentKey" },
    });
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    setBetterBibtexRecords(
      [{ citationKey: "CurrentKey", itemID: current.id }],
      ready,
    );

    const pending = findItemsByCitationKeys(["CurrentKey"]);
    await Promise.resolve();
    expect(betterBibtexAll).not.toHaveBeenCalled();
    markReady();
    const found = await pending;

    expect(betterBibtexAll).toHaveBeenCalledTimes(1);
    expect(dbQueryAsync).not.toHaveBeenCalled();
    expect(found.resolver).toEqual({
      source: "better-bibtex-key-manager",
      coverage: "complete",
    });
    expect(found.matches.get("CurrentKey")).toHaveLength(1);
    expect(found.matches.get("CurrentKey")?.[0].identity).toEqual({
      library_id: 1,
      library_type: "user",
      library_name: "My Library",
      zotero_item_key: "ITEM1",
      citation_key_sources: ["better-bibtex-key-manager"],
    });
  });

  it("reports ambiguity when one exact key exists in user and group libraries", async () => {
    makeItem({ id: 1, key: "USERITEM", libraryID: 1 });
    makeItem({ id: 2, key: "GROUPITEM", libraryID: 2 });
    setBetterBibtexRecords([
      { citationKey: "SharedKey", itemID: 2 },
      { citationKey: "SharedKey", itemID: 1 },
    ]);

    const batch = await buildInspireBibtexBatch(["SharedKey"]);
    expect(batch.outcome).toBe("error");
    expect(batch.results[0]).toMatchObject({
      citation_key: "SharedKey",
      status: "error",
      code: "CITATION_KEY_AMBIGUOUS",
      candidates: [
        {
          library_id: 1,
          library_type: "user",
          zotero_item_key: "USERITEM",
        },
        {
          library_id: 2,
          library_type: "group",
          zotero_item_key: "GROUPITEM",
        },
      ],
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });

  it("filters deleted, feed, and non-regular items", async () => {
    makeItem({ id: 1, deleted: true });
    makeItem({ id: 2, feed: true });
    makeItem({ id: 3, regular: false });
    makeItem({ id: 4, key: "VALID" });
    setBetterBibtexRecords(
      [1, 2, 3, 4].map((itemID) => ({
        citationKey: "FilteredKey",
        itemID,
      })),
    );

    const found = await findItemsByCitationKeys(["FilteredKey"]);
    expect(
      found.matches.get("FilteredKey")?.map((match) => match.item.id),
    ).toEqual([4]);
  });

  it("filters a feed item when isFeedItem is exposed as a method", async () => {
    makeItem({ id: 1, feed: true, feedAsMethod: true });
    makeItem({ id: 2, key: "VALID" });
    setBetterBibtexRecords([
      { citationKey: "MethodFeedKey", itemID: 1 },
      { citationKey: "MethodFeedKey", itemID: 2 },
    ]);

    const found = await findItemsByCitationKeys(["MethodFeedKey"]);
    expect(
      found.matches.get("MethodFeedKey")?.map((match) => match.item.id),
    ).toEqual([2]);
  });

  it("fails closed when an item's feed status cannot be read", async () => {
    const unknown = makeItem({ id: 1 });
    unknown.isFeedItem = vi.fn(() => {
      throw new Error("feed state unavailable");
    });
    makeItem({ id: 2, key: "VALID" });
    setBetterBibtexRecords([
      { citationKey: "FeedFailureKey", itemID: 1 },
      { citationKey: "FeedFailureKey", itemID: 2 },
    ]);

    const found = await findItemsByCitationKeys(["FeedFailureKey"]);
    expect(
      found.matches.get("FeedFailureKey")?.map((match) => match.item.id),
    ).toEqual([2]);
  });

  it("filters an item when its feed-status getter throws", async () => {
    const unknown = makeItem({ id: 1 });
    Object.defineProperty(unknown, "isFeedItem", {
      get: () => {
        throw new Error("feed getter unavailable");
      },
    });
    makeItem({ id: 2, key: "VALID" });
    setBetterBibtexRecords([
      { citationKey: "FeedGetterFailureKey", itemID: 1 },
      { citationKey: "FeedGetterFailureKey", itemID: 2 },
    ]);

    const found = await findItemsByCitationKeys(["FeedGetterFailureKey"]);
    expect(
      found.matches.get("FeedGetterFailureKey")?.map((match) => match.item.id),
    ).toEqual([2]);
  });

  it("matches citation keys with strict case sensitivity", async () => {
    makeItem({ id: 1 });
    setBetterBibtexRecords([{ citationKey: "ExactCase", itemID: 1 }]);
    const found = await findItemsByCitationKeys(["exactcase"]);
    expect(found.matches.get("exactcase")).toEqual([]);
  });

  it("falls back to native and Extra fields only when BBT is absent", async () => {
    (Zotero as any).BetterBibTeX = undefined;
    makeItem({ id: 7, key: "FALLBACK" });
    dbQueryAsync.mockImplementation(async (_sql: string, params: unknown[]) => {
      if (params[0] === 10) {
        return [{ itemID: 7, value: "FallbackKey" }];
      }
      if (params[0] === 11) {
        return [
          {
            itemID: 7,
            value: "Citation Key: Stale\r\nBibTeX: FallbackKey",
          },
        ];
      }
      return [];
    });

    const found = await findItemsByCitationKeys(["FallbackKey"]);
    expect(found.resolver).toEqual({
      source: "zotero-fields",
      coverage: "complete",
    });
    expect(found.matches.get("FallbackKey")?.[0].identity).toMatchObject({
      zotero_item_key: "FALLBACK",
      citation_key_sources: ["zotero-native", "zotero-extra"],
    });
    expect(dbQueryAsync).toHaveBeenCalledTimes(2);
  });

  it("does not accept a stale Extra-only key when native coverage is complete", async () => {
    (Zotero as any).BetterBibTeX = undefined;
    makeItem({
      id: 7,
      key: "RENAMED",
      fields: inspireFields("700", {
        citationKey: "NewKey",
        extra: "Citation Key: OldKey",
      }),
    });
    dbQueryAsync.mockImplementation(async (_sql: string, params: unknown[]) =>
      params[0] === 11 ? [{ itemID: 7, value: "Citation Key: OldKey" }] : [],
    );

    const batch = await buildInspireBibtexBatch(["OldKey"]);
    expect(batch.resolver).toEqual({
      source: "zotero-fields",
      coverage: "complete",
    });
    expect(batch.results[0]).toMatchObject({
      citation_key: "OldKey",
      status: "error",
      code: "CITATION_KEY_NOT_FOUND",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });

  it("treats a non-array Better BibTeX result as adapter unavailable", async () => {
    makeItem({ id: 8, key: "NATIVE" });
    betterBibtexAll = vi.fn(() => new Set());
    (Zotero as any).BetterBibTeX = {
      ready: Promise.resolve(),
      KeyManager: { all: betterBibtexAll },
    };
    dbQueryAsync.mockImplementation(async (_sql: string, params: unknown[]) =>
      params[0] === 10 ? [{ itemID: 8, value: "NativeKey" }] : [],
    );

    const found = await findItemsByCitationKeys(["NativeKey"]);
    expect(found.resolver).toEqual({
      source: "zotero-fields",
      coverage: "degraded",
    });
    expect(found.matches.get("NativeKey")?.[0].identity).toMatchObject({
      zotero_item_key: "NATIVE",
      citation_key_sources: ["zotero-native"],
    });
  });

  it.each([
    ["missing item ID", undefined],
    ["numeric-string item ID", "8"],
  ])(
    "treats a Better BibTeX record with %s as adapter unavailable",
    async (_label, itemID) => {
      makeItem({ id: 8, key: "NATIVE" });
      betterBibtexAll = vi.fn(() => [{ citationKey: "NativeKey", itemID }]);
      (Zotero as any).BetterBibTeX = {
        ready: Promise.resolve(),
        KeyManager: { all: betterBibtexAll },
      };
      dbQueryAsync.mockImplementation(
        async (_sql: string, params: unknown[]) =>
          params[0] === 10 ? [{ itemID: 8, value: "NativeKey" }] : [],
      );

      const found = await findItemsByCitationKeys(["NativeKey"]);
      expect(found.resolver).toEqual({
        source: "zotero-fields",
        coverage: "degraded",
      });
      expect(found.matches.get("NativeKey")?.[0].identity).toMatchObject({
        zotero_item_key: "NATIVE",
        citation_key_sources: ["zotero-native"],
      });
    },
  );

  it("single-flights a timed-out Better BibTeX readiness gate and recovers after its late resolve", async () => {
    vi.useFakeTimers();
    makeItem({ id: 12, key: "READY-ITEM" });
    let resolveReady!: (value?: unknown) => void;
    const readyThen = vi.fn(
      (resolve: (value?: unknown) => void, _reject: (err: unknown) => void) => {
        resolveReady = resolve;
      },
    );
    betterBibtexAll = vi.fn((predicate: (record: BbtRecord) => boolean) =>
      [{ citationKey: "ReadyKey", itemID: 12 }].filter(predicate),
    );
    (Zotero as any).BetterBibTeX = {
      ready: { then: readyThen },
      KeyManager: { all: betterBibtexAll },
    };
    dbQueryAsync.mockResolvedValue([]);

    const pending = findItemsByCitationKeys(["ReadyKey"]);
    await vi.advanceTimersByTimeAsync(
      INSPIRE_BIBTEX_API_LIMITS.betterBibtexReadyTimeoutMs,
    );
    const first = await pending;

    expect(first.resolver).toEqual({
      source: "zotero-fields",
      coverage: "degraded",
    });
    expect(readyThen).toHaveBeenCalledTimes(1);
    expect(betterBibtexAll).not.toHaveBeenCalled();

    const repeated = await findItemsByCitationKeys(["ReadyKey"]);
    expect(repeated.resolver).toEqual({
      source: "zotero-fields",
      coverage: "degraded",
    });
    expect(readyThen).toHaveBeenCalledTimes(1);

    resolveReady();
    await Promise.resolve();
    const recovered = await findItemsByCitationKeys(["ReadyKey"]);
    expect(recovered.resolver).toEqual({
      source: "better-bibtex-key-manager",
      coverage: "complete",
    });
    expect(recovered.matches.get("ReadyKey")?.[0].identity).toMatchObject({
      zotero_item_key: "READY-ITEM",
    });
    expect(readyThen).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected readiness identity unavailable and admits a replacement gate", async () => {
    makeItem({ id: 13, key: "REPLACEMENT-READY" });
    let rejectReady!: (err: unknown) => void;
    const rejectedThen = vi.fn(
      (_resolve: (value?: unknown) => void, reject: (err: unknown) => void) => {
        rejectReady = reject;
      },
    );
    betterBibtexAll = vi.fn((predicate: (record: BbtRecord) => boolean) =>
      [{ citationKey: "ReplacementKey", itemID: 13 }].filter(predicate),
    );
    const betterBibtex = {
      ready: { then: rejectedThen },
      KeyManager: { all: betterBibtexAll },
    };
    (Zotero as any).BetterBibTeX = betterBibtex;

    const rejectedPending = findItemsByCitationKeys(["ReplacementKey"]);
    rejectReady(new Error("not ready"));
    const rejected = await rejectedPending;
    expect(rejected.resolver.coverage).toBe("degraded");
    expect(
      (await findItemsByCitationKeys(["ReplacementKey"])).resolver,
    ).toEqual({ source: "zotero-fields", coverage: "degraded" });
    expect(rejectedThen).toHaveBeenCalledTimes(1);

    const replacementThen = vi.fn((resolve: (value?: unknown) => void) => {
      resolve();
    });
    betterBibtex.ready = { then: replacementThen };
    const replaced = await findItemsByCitationKeys(["ReplacementKey"]);
    expect(replaced.resolver).toEqual({
      source: "better-bibtex-key-manager",
      coverage: "complete",
    });
    expect(replacementThen).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "throws"])(
    "fails closed when the Zotero 8 native citation-key field %s",
    async (mode) => {
      (Zotero as any).BetterBibTeX = undefined;
      makeItem({ id: 9, key: "EXTRA-ONLY" });
      (Zotero.ItemFields.getID as ReturnType<typeof vi.fn>).mockImplementation(
        (field: string) => {
          if (field === "citationKey") {
            if (mode === "throws") throw new Error("field unavailable");
            return false;
          }
          return field === "extra" ? 11 : false;
        },
      );
      dbQueryAsync.mockResolvedValue([
        { itemID: 9, value: "Citation Key: ExtraOnly" },
      ]);

      const batch = await buildInspireBibtexBatch(["ExtraOnly"]);
      expect(batch.resolver).toEqual({
        source: "zotero-fields",
        coverage: "degraded",
      });
      expect(batch.results[0]).toMatchObject({
        citation_key: "ExtraOnly",
        status: "error",
        code: "CITATION_KEY_LOOKUP_UNAVAILABLE",
        candidates: [{ zotero_item_key: "EXTRA-ONLY" }],
      });
      expect(mocks.inspireFetch).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the native citation-key query is not an array", async () => {
    (Zotero as any).BetterBibTeX = undefined;
    dbQueryAsync.mockImplementation(async (_sql: string, params: unknown[]) =>
      params[0] === 10 ? ({} as any) : [],
    );

    const batch = await buildInspireBibtexBatch(["UnknownKey"]);
    expect(batch.resolver).toEqual({
      source: "zotero-fields",
      coverage: "degraded",
    });
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "CITATION_KEY_LOOKUP_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });

  it("fails closed when a native citation-key row is malformed", async () => {
    (Zotero as any).BetterBibTeX = undefined;
    dbQueryAsync.mockImplementation(async (_sql: string, params: unknown[]) =>
      params[0] === 10 ? [{ itemID: undefined, value: "UnknownKey" }] : [],
    );

    const batch = await buildInspireBibtexBatch(["UnknownKey"]);
    expect(batch.resolver).toEqual({
      source: "zotero-fields",
      coverage: "degraded",
    });
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "CITATION_KEY_LOOKUP_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });

  it("returns LOOKUP_UNAVAILABLE for a Zotero 7 degraded fallback miss", async () => {
    (Zotero as any).BetterBibTeX = undefined;
    (Zotero as any).platformMajorVersion = 7;
    dbQueryAsync.mockResolvedValue([]);

    const batch = await buildInspireBibtexBatch(["MissingKey"]);
    expect(batch.resolver).toEqual({
      source: "zotero-fields",
      coverage: "degraded",
    });
    expect(batch.results[0]).toMatchObject({
      citation_key: "MissingKey",
      status: "error",
      code: "CITATION_KEY_LOOKUP_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });

  it("fails closed on a single visible Zotero 7 fallback candidate", async () => {
    (Zotero as any).BetterBibTeX = undefined;
    (Zotero as any).platformMajorVersion = 7;
    makeItem({ id: 7, key: "VISIBLE", fields: inspireFields("700") });
    dbQueryAsync.mockImplementation(async (_sql: string, params: unknown[]) =>
      params[0] === 11
        ? [{ itemID: 7, value: "Citation Key: PossiblyShared" }]
        : [],
    );

    const batch = await buildInspireBibtexBatch(["PossiblyShared"]);
    expect(batch.results[0]).toMatchObject({
      citation_key: "PossiblyShared",
      status: "error",
      code: "CITATION_KEY_LOOKUP_UNAVAILABLE",
      candidates: [{ zotero_item_key: "VISIBLE" }],
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });
});

describe("INSPIRE lookup and BibTeX provenance", () => {
  it("fetches a recid from INSPIRE and rewrites its entry key to the request", async () => {
    prepareBbtItem("RequestedKey", {
      id: 41,
      key: "ZOTERO41",
      fields: inspireFields("123456"),
    });
    mocks.inspireFetch.mockResolvedValue(
      bibtexResponse("InspireGeneratedKey", "Canonical title"),
    );

    const batch = await buildInspireBibtexBatch(["RequestedKey"]);
    const result = batch.results[0] as any;

    expect(batch).toMatchObject({
      ok: true,
      outcome: "ok",
      api_version: "1",
      summary: { requested: 1, succeeded: 1, failed: 0 },
    });
    expect(result).toEqual({
      citation_key: "RequestedKey",
      status: "ok",
      item: {
        library_id: 1,
        library_type: "user",
        library_name: "My Library",
        zotero_item_key: "ZOTERO41",
        citation_key_sources: ["better-bibtex-key-manager"],
      },
      source: {
        provider: "INSPIRE-HEP",
        record_id: "123456",
        url: "https://inspirehep.net/api/literature/123456?format=bibtex",
        lookup: {
          type: "inspire-record-id",
          value: "123456",
          local_field: "archiveLocation",
        },
      },
      bibtex: {
        text: "@article{RequestedKey,\n  title = {Canonical title},\n  year = {2026}\n}",
        original_entry_key: "InspireGeneratedKey",
        entry_key: "RequestedKey",
        entry_key_rewritten: true,
      },
      field_provenance: {
        citation_key: "request",
        item: "zotero-item",
        "source.lookup": "zotero-item",
        "source.record_id": "zotero-item",
        "bibtex.original_entry_key": "INSPIRE-HEP",
        "bibtex.entry_key": "request",
        "bibtex.text_except_entry_key": "INSPIRE-HEP",
      },
      fields_from_inspire: [
        "bibtex.original_entry_key",
        "bibtex.text_except_entry_key",
      ],
      fields_from_better_bibtex: [],
    });
    expect(batch.bibtex).toBe(result.bibtex.text);
    expect(mocks.inspireFetch).toHaveBeenCalledWith(
      "https://inspirehep.net/api/literature/123456?format=bibtex",
      expect.objectContaining({
        headers: { Accept: "application/x-bibtex" },
        retryOnRateLimit: false,
        signal: expect.anything(),
      }),
    );
  });

  it("preserves INSPIRE leading and trailing whitespace outside the entry key", async () => {
    prepareBbtItem("WhitespaceKey", { fields: inspireFields("123457") });
    const source =
      " \n\t@article{ProviderKey,\n  title = {Whitespace}\n}\r\n  ";
    mocks.inspireFetch.mockResolvedValue(new Response(source, { status: 200 }));

    const batch = await buildInspireBibtexBatch(["WhitespaceKey"]);
    expect(batch.results[0]).toMatchObject({ status: "ok" });
    expect((batch.results[0] as any).bibtex.text).toBe(
      " \n\t@article{WhitespaceKey,\n  title = {Whitespace}\n}\r\n  ",
    );
  });

  it("preserves a UTF-8 BOM outside the rewritten entry key", async () => {
    prepareBbtItem("BomKey", { fields: inspireFields("123458") });
    const source = "\uFEFF@article{ProviderKey,\n  title = {BOM}\n}";
    mocks.inspireFetch.mockResolvedValue(new Response(source, { status: 200 }));

    const batch = await buildInspireBibtexBatch(["BomKey"]);
    expect(batch.results[0]).toMatchObject({ status: "ok" });
    expect((batch.results[0] as any).bibtex.text).toBe(
      "\uFEFF@article{BomKey,\n  title = {BOM}\n}",
    );
  });

  it("uses only zotero-inspire's canonical recid fields", async () => {
    prepareBbtItem("CanonicalRecid", {
      fields: inspireFields("333", {
        DOI: "10.5555/IGNORED",
        url: "https://inspirehep.net/api/literature/999",
        extra: "arXiv: 2401.01234",
      }),
    });
    mocks.inspireFetch.mockResolvedValue(bibtexResponse("canonical-source"));

    const batch = await buildInspireBibtexBatch(["CanonicalRecid"]);
    expect(batch.results[0]).toMatchObject({
      status: "ok",
      source: {
        provider: "INSPIRE-HEP",
        record_id: "333",
        lookup: {
          type: "inspire-record-id",
          value: "333",
          local_field: "archiveLocation",
        },
      },
    });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(1);
    expect(String(mocks.inspireFetch.mock.calls[0][0])).toContain(
      "/literature/333?format=bibtex",
    );
  });

  it("exports the uniquely matched item with Better BibTeX when no canonical INSPIRE recid exists", async () => {
    const item = prepareBbtItem("NoRecid", { fields: {} });
    const batch = await buildInspireBibtexBatch(["NoRecid"]);
    expect(batch.results[0]).toMatchObject({
      citation_key: "NoRecid",
      status: "ok",
      item: { zotero_item_key: "ITEM1" },
      source: {
        provider: "Better BibTeX",
        fallback_reason: "INSPIRE_RECID_MISSING",
        lookup: {
          type: "better-bibtex-export",
          value: "ITEM1",
          local_field: "zotero-item",
        },
      },
      bibtex: {
        text: "@article{NoRecid,\n  title = {Local fallback}\n}",
        original_entry_key: "better-bibtex-generated",
        entry_key: "NoRecid",
        entry_key_rewritten: true,
      },
      field_provenance: {
        "source.fallback_reason": "zotero-inspire",
        "bibtex.original_entry_key": "Better BibTeX",
        "bibtex.entry_key": "request",
        "bibtex.text_except_entry_key": "Better BibTeX",
      },
      fields_from_inspire: [],
      fields_from_better_bibtex: [
        "bibtex.original_entry_key",
        "bibtex.text_except_entry_key",
      ],
    });
    expect(batch.bibtex).toContain("@article{NoRecid,");
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
    expect(betterBibtexTranslations).toHaveLength(1);
    expect(betterBibtexTranslations[0].setItems).toHaveBeenCalledWith([item]);
    expect(betterBibtexTranslations[0].setTranslator).toHaveBeenCalledWith(
      "test-better-bibtex-translator",
    );
    expect(betterBibtexTranslations[0].setDisplayOptions).toHaveBeenCalledWith({
      worker: true,
      exportNotes: false,
      exportFileData: false,
      useJournalAbbreviation: false,
      keepUpdated: false,
    });
  });

  it("rejects an oversized canonical recid field before network access", async () => {
    prepareBbtItem("OversizedRecidField", {
      fields: inspireFields(
        "1".repeat(INSPIRE_BIBTEX_API_LIMITS.maxRecidFieldLength + 1),
      ),
    });

    const batch = await buildInspireBibtexBatch(["OversizedRecidField"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_RECID_FIELD_TOO_LARGE",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
    expect(betterBibtexTranslations).toHaveLength(0);
  });

  it("checks the raw canonical field length before trimming whitespace", async () => {
    prepareBbtItem("OversizedArchiveField", {
      fields: {
        archive: `INSPIRE${" ".repeat(
          INSPIRE_BIBTEX_API_LIMITS.maxRecidFieldLength,
        )}`,
        archiveLocation: "123",
      },
    });

    const batch = await buildInspireBibtexBatch(["OversizedArchiveField"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_RECID_FIELD_TOO_LARGE",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
    expect(betterBibtexTranslations).toHaveLength(0);
  });

  it("fails closed instead of treating an unreadable recid field as missing", async () => {
    const item = prepareBbtItem("UnreadableRecidField", {
      fields: { archive: "INSPIRE" },
    });
    item.getField.mockImplementation((field: string) => {
      if (field === "archiveLocation") throw new Error("private field failure");
      return field === "archive" ? "INSPIRE" : "";
    });

    const batch = await buildInspireBibtexBatch(["UnreadableRecidField"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_RECID_READ_ERROR",
      error: "The Zotero INSPIRE recid fields could not be read safely",
    });
    expect(JSON.stringify(batch.results[0])).not.toContain(
      "private field failure",
    );
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
    expect(betterBibtexTranslations).toHaveLength(0);
  });

  it("fails closed on a structurally invalid recid-field value", async () => {
    const item = prepareBbtItem("InvalidRecidFieldValue", {
      fields: { archive: "INSPIRE" },
    });
    item.getField.mockImplementation((field: string) => {
      if (field === "archive") return "INSPIRE";
      if (field === "archiveLocation") return { hidden: "123" } as any;
      return "";
    });

    const batch = await buildInspireBibtexBatch(["InvalidRecidFieldValue"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_RECID_READ_ERROR",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
    expect(betterBibtexTranslations).toHaveLength(0);
  });

  it.each(["abc", "0", "000", " 123 "])(
    "rejects malformed canonical recid %s without falling back",
    async (archiveLocation) => {
      prepareBbtItem("InvalidRecid", {
        fields: inspireFields(archiveLocation),
      });

      const batch = await buildInspireBibtexBatch(["InvalidRecid"]);
      expect(batch.results[0]).toMatchObject({
        status: "error",
        code: "INSPIRE_RECID_INVALID",
      });
      expect(mocks.inspireFetch).not.toHaveBeenCalled();
      expect(betterBibtexTranslations).toHaveLength(0);
    },
  );

  it("does not inspect archiveLocation for a non-INSPIRE item", async () => {
    const item = prepareBbtItem("OtherArchive", {
      fields: { archive: "Other" },
    });
    item.getField.mockImplementation((field: string) => {
      if (field === "archive") return "Other";
      if (field === "archiveLocation") {
        throw new Error("archiveLocation must not be inspected");
      }
      return "";
    });

    const batch = await buildInspireBibtexBatch(["OtherArchive"]);
    expect(batch.results[0]).toMatchObject({
      status: "ok",
      source: {
        provider: "Better BibTeX",
        fallback_reason: "INSPIRE_RECID_MISSING",
      },
    });
    expect(item.getField).not.toHaveBeenCalledWith("archiveLocation");
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["INSPIRE-HEP", "123"],
    ["inspire", "123"],
    [" INSPIRE ", "123"],
    ["INSPIRE", ""],
  ])(
    "falls back for non-canonical recid fields (%s, %s)",
    async (archive, archiveLocation) => {
      prepareBbtItem("MissingCanonicalRecid", {
        fields: { archive, archiveLocation },
      });

      const batch = await buildInspireBibtexBatch(["MissingCanonicalRecid"]);
      expect(batch.results[0]).toMatchObject({
        status: "ok",
        source: {
          provider: "Better BibTeX",
          fallback_reason: "INSPIRE_RECID_MISSING",
        },
      });
      expect(mocks.inspireFetch).not.toHaveBeenCalled();
    },
  );

  it("normalizes leading zeros in the canonical recid", async () => {
    prepareBbtItem("LeadingZeroRecid", {
      fields: inspireFields("000111"),
    });
    mocks.inspireFetch.mockResolvedValue(bibtexResponse("leading-zero-source"));

    const batch = await buildInspireBibtexBatch(["LeadingZeroRecid"]);
    expect(batch.results[0]).toMatchObject({
      status: "ok",
      source: { provider: "INSPIRE-HEP", record_id: "111" },
    });
    expect(String(mocks.inspireFetch.mock.calls[0][0])).toContain(
      "/literature/111?format=bibtex",
    );
  });

  it("uses Better BibTeX when the canonical INSPIRE recid returns 404", async () => {
    prepareBbtItem("NotFound", { fields: inspireFields("404404") });
    mocks.inspireFetch.mockResolvedValue(new Response("", { status: 404 }));
    const batch = await buildInspireBibtexBatch(["NotFound"]);
    expect(batch.results[0]).toMatchObject({
      status: "ok",
      source: {
        provider: "Better BibTeX",
        fallback_reason: "INSPIRE_RECORD_NOT_FOUND",
        lookup: {
          type: "better-bibtex-export",
          value: "ITEM1",
          local_field: "zotero-item",
        },
      },
      bibtex: { entry_key: "NotFound" },
      fields_from_inspire: [],
      fields_from_better_bibtex: [
        "bibtex.original_entry_key",
        "bibtex.text_except_entry_key",
      ],
    });
    expect(betterBibtexTranslations).toHaveLength(1);
  });

  it.each([
    [400, "INSPIRE_HTTP_ERROR"],
    [429, "INSPIRE_RATE_LIMITED"],
    [500, "INSPIRE_HTTP_ERROR"],
  ])("maps upstream HTTP %i to %s", async (status, code) => {
    prepareBbtItem("HttpFailure", { fields: inspireFields("55") });
    mocks.inspireFetch.mockResolvedValue(
      new Response("upstream failure", {
        status,
        headers: status === 429 ? { "Retry-After": "3" } : undefined,
      }),
    );
    const batch = await buildInspireBibtexBatch(["HttpFailure"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code,
      item: { zotero_item_key: "ITEM1" },
      attempted_lookups: [
        {
          type: "inspire-record-id",
          value: "55",
          local_field: "archiveLocation",
        },
      ],
    });
    expect(betterBibtexTranslations).toHaveLength(0);
  });

  it("maps a rejected fetch to INSPIRE_NETWORK_ERROR", async () => {
    prepareBbtItem("NetworkFailure", { fields: inspireFields("56") });
    mocks.inspireFetch.mockRejectedValue(new Error("connection reset"));
    const batch = await buildInspireBibtexBatch(["NetworkFailure"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_ERROR",
      error: "INSPIRE request failed before a response was received",
      item: { zotero_item_key: "ITEM1" },
      attempted_lookups: [
        {
          type: "inspire-record-id",
          value: "56",
          local_field: "archiveLocation",
        },
      ],
    });
    expect(JSON.stringify(batch.results[0])).not.toContain("connection reset");
  });

  it("rejects syntactically invalid INSPIRE BibTeX", async () => {
    prepareBbtItem("InvalidBibtex", { fields: inspireFields("57") });
    mocks.inspireFetch.mockResolvedValue(
      new Response("not a BibTeX data entry", { status: 200 }),
    );
    const batch = await buildInspireBibtexBatch(["InvalidBibtex"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_BIBTEX_INVALID",
    });
  });

  it("rejects an oversized INSPIRE BibTeX response before reading it", async () => {
    prepareBbtItem("Oversized", { fields: inspireFields("58") });
    mocks.inspireFetch.mockResolvedValue(
      new Response("x", {
        status: 200,
        headers: {
          "Content-Length": String(
            INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes + 1,
          ),
        },
      }),
    );
    const batch = await buildInspireBibtexBatch(["Oversized"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_BIBTEX_TOO_LARGE",
    });
  });

  it("rechecks the INSPIRE byte cap after expanding the entry key", async () => {
    const citationKey = "K".repeat(
      INSPIRE_BIBTEX_API_LIMITS.maxCitationKeyLength,
    );
    prepareBbtItem(citationKey, { fields: inspireFields("580") });
    mocks.inspireFetch.mockResolvedValue(
      new Response(
        sizedBibtex("k", INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes),
        { status: 200 },
      ),
    );

    const batch = await buildInspireBibtexBatch([citationKey]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_BIBTEX_TOO_LARGE",
    });
  });

  it("accepts an INSPIRE entry whose rewritten form exactly reaches the byte cap", async () => {
    const citationKey = "K".repeat(
      INSPIRE_BIBTEX_API_LIMITS.maxCitationKeyLength,
    );
    const growth = utf8ByteLength(citationKey) - utf8ByteLength("k");
    prepareBbtItem(citationKey, { fields: inspireFields("5801") });
    mocks.inspireFetch.mockResolvedValue(
      new Response(
        sizedBibtex(
          "k",
          INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes - growth,
        ),
        { status: 200 },
      ),
    );

    const batch = await buildInspireBibtexBatch([citationKey]);
    expect(batch.results[0]).toMatchObject({ status: "ok" });
    expect(utf8ByteLength((batch.results[0] as any).bibtex.text)).toBe(
      INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes,
    );
  });

  it("blocks queued and new requests until non-timeout stream cleanup settles", async () => {
    const activeKeys = [
      "NonSettlingCancel",
      "HeldDuringCancel1",
      "HeldDuringCancel2",
      "HeldDuringCancel3",
    ];
    const queuedKey = "QueuedDuringCancel";
    [...activeKeys, queuedKey].forEach((citationKey, index) => {
      makeItem({ id: index + 1, fields: inspireFields(String(581 + index)) });
    });
    setBetterBibtexRecords(
      [...activeKeys, queuedKey].map((citationKey, index) => ({
        citationKey,
        itemID: index + 1,
      })),
    );

    let resolveCancel!: () => void;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const releaseLock = vi.fn();
    const fetchResolves: Array<(response: Response) => void> = [];
    mocks.inspireFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          fetchResolves.push(resolve);
        }),
    );

    const activePending = buildInspireBibtexBatch(activeKeys);
    const queuedPending = buildInspireBibtexBatch([queuedKey]);
    await waitForCondition(
      () => fetchResolves.length === 4,
      "the four active non-timeout requests",
    );
    await Promise.resolve();
    await Promise.resolve();

    fetchResolves[0]({
      status: 200,
      ok: true,
      headers: { get: vi.fn(() => null) },
      body: {
        getReader: () => ({
          read: vi.fn(async () => ({
            done: false,
            value: new Uint8Array(
              INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes + 1,
            ),
          })),
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response);

    const queued = await Promise.race([
      queuedPending,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("queued cleanup rejection did not settle")),
          250,
        ),
      ),
    ]);
    expect(queued.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_UNAVAILABLE",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);

    makeItem({ id: 6, fields: inspireFields("587") });
    setBetterBibtexRecords([{ citationKey: "BlockedByCancel", itemID: 6 }]);
    const blocked = await buildInspireBibtexBatch(["BlockedByCancel"]);
    expect(blocked.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);

    resolveCancel();
    await Promise.resolve();
    await Promise.resolve();
    fetchResolves
      .slice(1)
      .forEach((resolve, index) =>
        resolve(bibtexResponse(`held-source-${index}`)),
      );
    const active = await activePending;
    expect(active.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_BIBTEX_TOO_LARGE",
    });
    expect(active.results.slice(1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "ok" })]),
    );

    makeItem({ id: 7, fields: inspireFields("588") });
    setBetterBibtexRecords([{ citationKey: "AfterOversize", itemID: 7 }]);
    mocks.inspireFetch.mockResolvedValue(bibtexResponse("after-oversize"));
    const recovered = await buildInspireBibtexBatch(["AfterOversize"]);
    expect(recovered.results[0]).toMatchObject({ status: "ok" });
  });

  it("maps response-stream failures to a generic network error", async () => {
    prepareBbtItem("StreamFailure", { fields: inspireFields("583") });
    const releaseLock = vi.fn();
    const cancel = vi.fn(() => Promise.resolve());
    mocks.inspireFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: vi.fn(() => null) },
      body: {
        getReader: () => ({
          read: vi.fn(async () => {
            throw new TypeError("private stream detail");
          }),
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response);

    const batch = await buildInspireBibtexBatch(["StreamFailure"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_ERROR",
      error: "INSPIRE response stream failed before the body was complete",
    });
    expect(JSON.stringify(batch.results[0])).not.toContain(
      "private stream detail",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed UTF-8 from the INSPIRE BibTeX stream", async () => {
    prepareBbtItem("MalformedUtf8", { fields: inspireFields("584") });
    const cancel = vi.fn(() => Promise.resolve());
    const releaseLock = vi.fn();
    mocks.inspireFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: vi.fn(() => null) },
      body: {
        getReader: () => ({
          read: vi.fn(async () => ({
            done: false,
            value: new Uint8Array([0xc3, 0x28]),
          })),
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response);

    const batch = await buildInspireBibtexBatch(["MalformedUtf8"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_BIBTEX_INVALID",
      error: "INSPIRE returned BibTeX that is not valid UTF-8",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of using an unbounded non-streaming response read", async () => {
    prepareBbtItem("UnboundedResponse", { fields: inspireFields("580") });
    const text = vi.fn(async () => bibtexResponse("unsafe").text());
    mocks.inspireFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: vi.fn(() => null) },
      body: null,
      text,
    } as unknown as Response);

    const batch = await buildInspireBibtexBatch(["UnboundedResponse"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_RESPONSE_LIMIT_UNAVAILABLE",
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("aborts and reports an INSPIRE timeout", async () => {
    vi.useFakeTimers();
    prepareBbtItem("TimeoutKey", { fields: inspireFields("59") });
    mocks.inspireFetch.mockImplementation(
      async (_url: unknown, options: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const pending = buildInspireBibtexBatch(["TimeoutKey"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(
      INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs,
    );
    const batch = await pending;
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_TIMEOUT",
      attempted_lookups: [{ type: "inspire-record-id", value: "59" }],
    });
  });

  it("blocks new requests until a timed-out fetch settles, then cancels the late response and recovers", async () => {
    vi.useFakeTimers();
    prepareBbtItem("LateResponse", { fields: inspireFields("591") });
    let resolveFetch!: (response: Response) => void;
    mocks.inspireFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const pending = buildInspireBibtexBatch(["LateResponse"]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(
      INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs,
    );
    const timedOut = await pending;
    expect(timedOut.results[0]).toMatchObject({ code: "INSPIRE_TIMEOUT" });

    makeItem({ id: 2, fields: inspireFields("592") });
    setBetterBibtexRecords([{ citationKey: "BlockedByLateFetch", itemID: 2 }]);
    const blocked = await buildInspireBibtexBatch(["BlockedByLateFetch"]);
    expect(blocked.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_UNAVAILABLE",
      error:
        "INSPIRE network access is unavailable while a prior operation or response cleanup is still running",
    });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(1);

    const cancel = vi.fn(() => Promise.resolve());
    resolveFetch({
      status: 200,
      ok: true,
      headers: { get: vi.fn(() => null) },
      body: { cancel },
    } as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);

    makeItem({ id: 3, fields: inspireFields("593") });
    setBetterBibtexRecords([{ citationKey: "AfterLateFetch", itemID: 3 }]);
    mocks.inspireFetch.mockResolvedValue(bibtexResponse("after-late-fetch"));
    const recovered = await buildInspireBibtexBatch(["AfterLateFetch"]);
    expect(recovered.results[0]).toMatchObject({ status: "ok" });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(2);
  });

  it("blocks queued and new requests while timed-out response reads remain unsettled", async () => {
    vi.useFakeTimers();
    const keys = Array.from({ length: 4 }, (_, index) => `HungStream${index}`);
    keys.forEach((citationKey, index) => {
      makeItem({ id: index + 1, fields: inspireFields(String(600 + index)) });
    });
    setBetterBibtexRecords(
      keys.map((citationKey, index) => ({ citationKey, itemID: index + 1 })),
    );
    const readResolves: Array<
      (result: ReadableStreamReadResult<Uint8Array>) => void
    > = [];
    const cancel = vi.fn(() => Promise.resolve());
    mocks.inspireFetch.mockImplementation(
      async () =>
        ({
          status: 200,
          ok: true,
          headers: { get: vi.fn(() => null) },
          body: {
            getReader: () => ({
              read: vi.fn(
                () =>
                  new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) =>
                    readResolves.push(resolve),
                  ),
              ),
              cancel,
              releaseLock: vi.fn(),
            }),
          },
        }) as unknown as Response,
    );

    const pending = buildInspireBibtexBatch(keys);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);
    await waitForCondition(
      () => readResolves.length === 4,
      "the four active response reads",
    );

    makeItem({ id: 5, fields: inspireFields("699") });
    setBetterBibtexRecords([{ citationKey: "QueuedStream", itemID: 5 }]);
    const queued = buildInspireBibtexBatch(["QueuedStream"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(
      INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs,
    );
    const [timedOut, queuedResult] = await Promise.all([pending, queued]);
    expect(timedOut.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INSPIRE_TIMEOUT" }),
      ]),
    );
    expect(queuedResult.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_UNAVAILABLE",
    });
    expect(cancel).toHaveBeenCalledTimes(4);

    makeItem({ id: 6, fields: inspireFields("700") });
    setBetterBibtexRecords([{ citationKey: "BlockedStream", itemID: 6 }]);
    const blocked = await buildInspireBibtexBatch(["BlockedStream"]);
    expect(blocked.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);

    readResolves.splice(0).forEach((resolve) => resolve({ done: true }));
    await Promise.resolve();
    await Promise.resolve();

    makeItem({ id: 7, fields: inspireFields("701") });
    setBetterBibtexRecords([{ citationKey: "AfterHungStreams", itemID: 7 }]);
    mocks.inspireFetch.mockResolvedValue(bibtexResponse("after-hung-streams"));
    const recovered = await buildInspireBibtexBatch(["AfterHungStreams"]);
    expect(recovered.results[0]).toMatchObject({ status: "ok" });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(5);
  });

  it("does not start network work when AbortController is unavailable", async () => {
    vi.stubGlobal("AbortController", undefined);
    prepareBbtItem("NoAbortController", { fields: inspireFields("590") });

    const batch = await buildInspireBibtexBatch(["NoAbortController"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_ABORT_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });
});

describe("Better BibTeX fallback", () => {
  it("reports unavailable fallback without attempting INSPIRE when the item has no canonical recid", async () => {
    prepareBbtItem("UnavailableFallback", { fields: {} });
    (Zotero as any).Translate.Export = undefined;

    const batch = await buildInspireBibtexBatch(["UnavailableFallback"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "BETTER_BIBTEX_FALLBACK_UNAVAILABLE",
      item: { zotero_item_key: "ITEM1" },
      source: {
        provider: "Better BibTeX",
        fallback_reason: "INSPIRE_RECID_MISSING",
      },
    });
    expect(mocks.inspireFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["non-string", { bibtex: "not a string" }],
    [
      "multiple entries",
      "@article{one, title={One}}\n@article{two, title={Two}}",
    ],
  ])("rejects %s Better BibTeX output", async (_label, output) => {
    prepareBbtItem("InvalidFallback", { fields: {} });
    setBetterBibtexExportOutput(output);

    const batch = await buildInspireBibtexBatch(["InvalidFallback"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "BETTER_BIBTEX_FALLBACK_INVALID",
      source: { fallback_reason: "INSPIRE_RECID_MISSING" },
    });
  });

  it("rejects oversized Better BibTeX output before parsing", async () => {
    prepareBbtItem("OversizedFallback", { fields: {} });
    setBetterBibtexExportOutput(
      `@article{source, title={${"x".repeat(
        INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes,
      )}}}`,
    );

    const batch = await buildInspireBibtexBatch(["OversizedFallback"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "BETTER_BIBTEX_FALLBACK_TOO_LARGE",
    });
  });

  it("rechecks the Better BibTeX byte cap after expanding the entry key", async () => {
    const citationKey = "K".repeat(
      INSPIRE_BIBTEX_API_LIMITS.maxCitationKeyLength,
    );
    prepareBbtItem(citationKey, { fields: {} });
    const keyGrowth = utf8ByteLength(citationKey) - utf8ByteLength("s");
    setBetterBibtexExportOutput(
      sizedBibtex(
        "s",
        INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes - keyGrowth + 1,
      ),
    );

    const batch = await buildInspireBibtexBatch([citationKey]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "BETTER_BIBTEX_FALLBACK_TOO_LARGE",
    });
  });

  it("accepts Better BibTeX output that reaches the byte cap after rewrite", async () => {
    const citationKey = "K".repeat(
      INSPIRE_BIBTEX_API_LIMITS.maxCitationKeyLength,
    );
    prepareBbtItem(citationKey, { fields: {} });
    const keyGrowth = utf8ByteLength(citationKey) - utf8ByteLength("s");
    setBetterBibtexExportOutput(
      sizedBibtex(
        "s",
        INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes - keyGrowth,
      ),
    );

    const batch = await buildInspireBibtexBatch([citationKey]);
    expect(batch.results[0]).toMatchObject({
      status: "ok",
      bibtex: { entry_key: citationKey },
    });
    expect(utf8ByteLength(batch.results[0].bibtex.text)).toBe(
      INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes,
    );
  });

  it("maps Better BibTeX export rejection without exposing its exception", async () => {
    prepareBbtItem("RejectedFallback", { fields: {} });
    betterBibtexExportImplementation = async () => {
      throw new Error("private translator failure");
    };

    const batch = await buildInspireBibtexBatch(["RejectedFallback"]);
    expect(batch.results[0]).toMatchObject({
      status: "error",
      code: "BETTER_BIBTEX_FALLBACK_ERROR",
      error: "Better BibTeX export failed",
    });
    expect(JSON.stringify(batch.results[0])).not.toContain(
      "private translator failure",
    );
  });

  it.each(["resolve", "reject"])(
    "opens a circuit after a hung export and recovers after its late %s",
    async (lateOutcome) => {
      vi.useFakeTimers();
      makeItem({ id: 11, fields: {} });
      makeItem({ id: 12, fields: {} });
      setBetterBibtexRecords([
        { citationKey: "HungFallback", itemID: 11 },
        { citationKey: "QueuedFallback", itemID: 12 },
      ]);
      let settle!: () => void;
      betterBibtexExportImplementation = () =>
        new Promise<void>((resolve, reject) => {
          settle = () => {
            if (lateOutcome === "resolve") resolve();
            else reject(new Error("late export failure"));
          };
        });

      const pending = buildInspireBibtexBatch([
        "HungFallback",
        "QueuedFallback",
      ]);
      await vi.advanceTimersByTimeAsync(0);
      expect(betterBibtexTranslations).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(
        INSPIRE_BIBTEX_API_LIMITS.betterBibtexExportTimeoutMs,
      );
      const timedOut = await pending;
      expect(timedOut.results[0]).toMatchObject({
        status: "error",
        code: "BETTER_BIBTEX_FALLBACK_TIMEOUT",
      });
      expect(timedOut.results[1]).toMatchObject({
        status: "error",
        code: "BETTER_BIBTEX_FALLBACK_UNAVAILABLE",
      });
      expect(betterBibtexTranslations).toHaveLength(1);

      makeItem({ id: 13, fields: {} });
      setBetterBibtexRecords([{ citationKey: "BlockedFallback", itemID: 13 }]);
      const blocked = await buildInspireBibtexBatch(["BlockedFallback"]);
      expect(blocked.results[0]).toMatchObject({
        status: "error",
        code: "BETTER_BIBTEX_FALLBACK_UNAVAILABLE",
      });
      expect(betterBibtexTranslations).toHaveLength(1);

      settle();
      const translatePromise = betterBibtexTranslations[0].translate.mock
        .results[0].value as Promise<void>;
      await translatePromise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();

      setBetterBibtexExportOutput(
        "@article{recovered-source, title={Recovered}}",
      );
      makeItem({ id: 14, fields: {} });
      setBetterBibtexRecords([
        { citationKey: "RecoveredFallback", itemID: 14 },
      ]);
      const recovered = await buildInspireBibtexBatch(["RecoveredFallback"]);
      expect(recovered.results[0]).toMatchObject({
        status: "ok",
        bibtex: { entry_key: "RecoveredFallback" },
      });
      expect(betterBibtexTranslations).toHaveLength(2);
    },
  );
});

describe("batch outcomes and ordering", () => {
  it("returns a partial result when the guarded fallback is unavailable", async () => {
    makeItem({ id: 1, fields: inspireFields("701") });
    makeItem({ id: 2, fields: inspireFields("702") });
    setBetterBibtexRecords([
      { citationKey: "SuccessKey", itemID: 1 },
      { citationKey: "MissingKey", itemID: 2 },
    ]);
    (Zotero as any).Translate.Export = undefined;
    mocks.inspireFetch.mockImplementation(async (urlValue: unknown) =>
      String(urlValue).includes("/701?")
        ? bibtexResponse("source-success")
        : new Response("", { status: 404 }),
    );

    const batch = await buildInspireBibtexBatch(["SuccessKey", "MissingKey"]);
    expect(batch).toMatchObject({
      ok: false,
      outcome: "partial",
      summary: { requested: 2, succeeded: 1, failed: 1 },
    });
    expect(batch.results.map((result) => result.citation_key)).toEqual([
      "SuccessKey",
      "MissingKey",
    ]);
    expect(batch.results[0]).toMatchObject({
      status: "ok",
      bibtex: { entry_key: "SuccessKey" },
    });
    expect(batch.results[1]).toMatchObject({
      status: "error",
      code: "BETTER_BIBTEX_FALLBACK_UNAVAILABLE",
      source: {
        provider: "Better BibTeX",
        fallback_reason: "INSPIRE_RECORD_NOT_FOUND",
      },
    });
    expect(batch.bibtex).toContain("@article{SuccessKey,");
    expect(batch.bibtex).not.toContain("MissingKey");
  });

  it("merges successful entries in request order", async () => {
    makeItem({ id: 1, fields: inspireFields("801") });
    makeItem({ id: 2, fields: inspireFields("802") });
    setBetterBibtexRecords([
      { citationKey: "FirstKey", itemID: 1 },
      { citationKey: "SecondKey", itemID: 2 },
    ]);
    mocks.inspireFetch.mockImplementation(async (urlValue: unknown) => {
      const url = String(urlValue);
      return url.includes("/801?")
        ? bibtexResponse("source-first", "First")
        : bibtexResponse("source-second", "Second");
    });

    const batch = await buildInspireBibtexBatch(["FirstKey", "SecondKey"]);
    const first = batch.bibtex.indexOf("@article{FirstKey,");
    const second = batch.bibtex.indexOf("@article{SecondKey,");
    expect(batch.outcome).toBe("ok");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(batch.bibtex).toBe(
      `${(batch.results[0] as any).bibtex.text}\n\n${(batch.results[1] as any).bibtex.text}`,
    );
  });

  it("enforces the network concurrency limit across simultaneous requests", async () => {
    const firstKeys = Array.from({ length: 4 }, (_, index) => `First${index}`);
    const secondKeys = Array.from(
      { length: 4 },
      (_, index) => `Second${index}`,
    );
    const keys = [...firstKeys, ...secondKeys];
    keys.forEach((citationKey, index) => {
      makeItem({ id: index + 1, fields: inspireFields(String(1200 + index)) });
    });
    setBetterBibtexRecords(
      keys.map((citationKey, index) => ({ citationKey, itemID: index + 1 })),
    );

    let activeFetches = 0;
    let peakFetches = 0;
    const releases: Array<() => void> = [];
    mocks.inspireFetch.mockImplementation(
      (urlValue: unknown) =>
        new Promise<Response>((resolve) => {
          activeFetches++;
          peakFetches = Math.max(peakFetches, activeFetches);
          const recordID =
            String(urlValue).match(/literature\/(\d+)/)?.[1] ?? "0";
          releases.push(() => {
            activeFetches--;
            resolve(bibtexResponse(`source-${recordID}`));
          });
        }),
    );

    const first = buildInspireBibtexBatch(firstKeys);
    const second = buildInspireBibtexBatch(secondKeys);
    await waitForCondition(
      () => releases.length === INSPIRE_BIBTEX_API_LIMITS.networkConcurrency,
      "the first global network window",
    );
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);
    expect(peakFetches).toBe(4);

    releases.splice(0).forEach((release) => release());
    await waitForCondition(
      () => releases.length === INSPIRE_BIBTEX_API_LIMITS.networkConcurrency,
      "the second global network window",
    );
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(8);
    expect(peakFetches).toBe(4);
    releases.splice(0).forEach((release) => release());

    const [firstBatch, secondBatch] = await Promise.all([first, second]);
    expect(firstBatch.outcome).toBe("ok");
    expect(secondBatch.outcome).toBe("ok");
  });

  it("rejects queued work while timed-out fetches remain unsettled and recovers only after late cleanup", async () => {
    vi.useFakeTimers();
    const activeKeys = Array.from(
      { length: 4 },
      (_, index) => `Active${index}`,
    );
    const queuedKey = "Queued";
    [...activeKeys, queuedKey].forEach((citationKey, index) => {
      makeItem({ id: index + 1, fields: inspireFields(String(1400 + index)) });
    });
    setBetterBibtexRecords(
      [...activeKeys, queuedKey].map((citationKey, index) => ({
        citationKey,
        itemID: index + 1,
      })),
    );
    const fetchResolves: Array<(response: Response) => void> = [];
    mocks.inspireFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          fetchResolves.push(resolve);
        }),
    );

    const activeBatch = buildInspireBibtexBatch(activeKeys);
    const queuedBatch = buildInspireBibtexBatch([queuedKey]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(
      INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs,
    );
    const [activeResult, queuedResult] = await Promise.all([
      activeBatch,
      queuedBatch,
    ]);
    expect(activeResult.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INSPIRE_TIMEOUT" }),
      ]),
    );
    expect(queuedResult.results[0]).toMatchObject({
      code: "INSPIRE_NETWORK_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);

    makeItem({ id: 6, fields: inspireFields("1500") });
    setBetterBibtexRecords([{ citationKey: "StillBlocked", itemID: 6 }]);
    const blocked = await buildInspireBibtexBatch(["StillBlocked"]);
    expect(blocked.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);

    const cancelResolves: Array<() => void> = [];
    const cancels = fetchResolves.map(() =>
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            cancelResolves.push(resolve);
          }),
      ),
    );
    fetchResolves.forEach((resolve, index) => {
      resolve({
        status: 200,
        ok: true,
        headers: { get: vi.fn(() => null) },
        body: { cancel: cancels[index] },
      } as unknown as Response);
    });
    await waitForCondition(
      () => cancels.every((cancel) => cancel.mock.calls.length === 1),
      "late fetch response cancellation",
    );

    makeItem({ id: 7, fields: inspireFields("1501") });
    setBetterBibtexRecords([{ citationKey: "BlockedByCleanup", itemID: 7 }]);
    const cleanupBlocked = await buildInspireBibtexBatch(["BlockedByCleanup"]);
    expect(cleanupBlocked.results[0]).toMatchObject({
      status: "error",
      code: "INSPIRE_NETWORK_UNAVAILABLE",
    });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(4);

    cancelResolves.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();

    makeItem({ id: 8, fields: inspireFields("1502") });
    setBetterBibtexRecords([{ citationKey: "Recovered", itemID: 8 }]);
    mocks.inspireFetch.mockResolvedValue(bibtexResponse("recovered-source"));
    const recovered = await buildInspireBibtexBatch(["Recovered"]);
    expect(recovered.results[0]).toMatchObject({ status: "ok" });
    expect(mocks.inspireFetch).toHaveBeenCalledTimes(5);
  });

  it("turns entries beyond the merged BibTeX budget into partial failures", async () => {
    const keys = ["BudgetOne", "BudgetTwo", "BudgetThree", "BudgetFour"];
    for (let index = 0; index < keys.length; index++) {
      makeItem({
        id: index + 1,
        fields: inspireFields(String(900 + index)),
      });
    }
    setBetterBibtexRecords(
      keys.map((citationKey, index) => ({ citationKey, itemID: index + 1 })),
    );
    mocks.inspireFetch.mockImplementation(async (urlValue: unknown) => {
      const recordID = String(urlValue).match(/literature\/(\d+)/)?.[1] ?? "0";
      return bibtexResponse(`source-${recordID}`, "x".repeat(100 * 1024));
    });

    const batch = await buildInspireBibtexBatch(keys);
    expect(batch).toMatchObject({
      ok: false,
      outcome: "partial",
      summary: { requested: 4, succeeded: 3, failed: 1 },
    });
    expect(batch.results[3]).toMatchObject({
      citation_key: "BudgetFour",
      status: "error",
      code: "RESPONSE_LIMIT_EXCEEDED",
    });
    expect(
      new TextEncoder().encode(batch.bibtex).byteLength,
    ).toBeLessThanOrEqual(INSPIRE_BIBTEX_API_LIMITS.maxMergedBibtexBytes);
  });
});

describe("connector contract", () => {
  it("returns the exact ping version, capabilities, limits, and security", async () => {
    const { status, body } = parse(
      await dispatchInspireBibtexOp({ op: "ping" }),
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      op: "ping",
      api_version: INSPIRE_BIBTEX_API_VERSION,
      addon: config.addonName,
      addon_id: config.addonID,
      plugin_version: version,
      capabilities: {
        operations: ["ping", "fetch"],
        resolver_priority: ["better-bibtex-key-manager", "zotero-fields"],
        partial_results: true,
        entry_key_rewrite: true,
        provider_priority: ["INSPIRE-HEP", "Better BibTeX"],
        fallback_provider: "Better BibTeX",
      },
      limits: {
        max_citation_keys: 20,
        max_citation_key_length: 200,
        better_bibtex_ready_timeout_ms: 2_000,
        better_bibtex_export_timeout_ms: 5_000,
        better_bibtex_export_concurrency: 1,
        network_timeout_ms: 10_000,
        network_concurrency: 4,
        max_recid_field_length: 64,
        max_bibtex_entry_bytes: 128 * 1024,
        max_merged_bibtex_bytes: 384 * 1024,
        max_response_bytes: 1024 * 1024,
      },
      security: {
        read_only: true,
        connector_loopback: true,
        unsafe_web_content_allowed: false,
        auth_header: "x-zinspire-read-token",
      },
    });
  });

  it("rejects malformed bodies, unknown operations, and invalid fetch keys", async () => {
    expect(parse(await dispatchInspireBibtexOp(null))).toMatchObject({
      status: 400,
      body: { ok: false, api_version: "1", code: "INVALID_REQUEST" },
    });
    expect(parse(await dispatchInspireBibtexOp({}))).toMatchObject({
      status: 400,
      body: { ok: false, api_version: "1", code: "INVALID_REQUEST" },
    });
    expect(
      parse(await dispatchInspireBibtexOp({ op: "unknown" })),
    ).toMatchObject({
      status: 400,
      body: { ok: false, api_version: "1", code: "INVALID_OP" },
    });
    expect(
      parse(
        await dispatchInspireBibtexOp({
          op: "fetch",
          citation_keys: ["bad key"],
        }),
      ),
    ).toMatchObject({
      status: 400,
      body: { ok: false, api_version: "1", code: "INVALID_CITATION_KEYS" },
    });
  });

  it("does not reflect an oversized unknown operation into the response", async () => {
    const unknownOp = "X".repeat(
      INSPIRE_BIBTEX_API_LIMITS.maxResponseBytes + 1,
    );
    const raw = await dispatchInspireBibtexOp({ op: unknownOp });
    const response = parse(raw);

    expect(response).toMatchObject({
      status: 400,
      body: {
        ok: false,
        code: "INVALID_OP",
        error: "Unsupported request op",
      },
    });
    expect(utf8ByteLength(raw[2])).toBeLessThanOrEqual(
      INSPIRE_BIBTEX_API_LIMITS.maxResponseBytes,
    );
    expect(raw[2]).not.toContain(unknownOp);
  });

  it("does not expose unexpected internal error messages to clients", async () => {
    (Zotero as any).BetterBibTeX = undefined;
    (Zotero.ItemFields.getID as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error("sensitive internal path");
      },
    );

    const response = parse(
      await dispatchInspireBibtexOp({
        op: "fetch",
        citation_keys: ["SecretKey"],
      }),
    );
    expect(response).toMatchObject({
      status: 500,
      body: {
        code: "INTERNAL_ERROR",
        error: "Unexpected internal failure while processing the request",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "sensitive internal path",
    );
  });

  it("rejects a serialized fetch response beyond the absolute JSON limit", async () => {
    prepareBbtItem("HugeIdentity", {
      fields: inspireFields("987654"),
    });
    (Zotero.Libraries.get as ReturnType<typeof vi.fn>).mockReturnValue({
      libraryType: "user",
      name: "L".repeat(INSPIRE_BIBTEX_API_LIMITS.maxResponseBytes),
    });
    mocks.inspireFetch.mockResolvedValue(bibtexResponse("source-key"));

    const response = parse(
      await dispatchInspireBibtexOp({
        op: "fetch",
        citation_keys: ["HugeIdentity"],
      }),
    );
    expect(response).toMatchObject({
      status: 413,
      body: {
        ok: false,
        api_version: "1",
        code: "RESPONSE_TOO_LARGE",
      },
    });
  });

  it("declares only POST JSON and disallows bookmarklets", () => {
    const endpoint = getRegisteredEndpoint();
    expect(endpoint.supportedMethods).toEqual(["POST"]);
    expect(endpoint.supportedDataTypes).toEqual(["application/json"]);
    expect(endpoint.permitBookmarklet).toBe(false);
  });
});

describe("connector token authentication", () => {
  it("fails closed when the read token has not been initialized", async () => {
    mocks.readExternalReadToken.mockReturnValue(null);
    const endpoint = getRegisteredEndpoint();
    const { status, body } = parse(
      await endpoint.init({ headers: {}, data: { op: "ping" } }),
    );
    expect(status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      api_version: "1",
      code: "TOKEN_UNAVAILABLE",
    });
  });

  it("rejects a missing or incorrect read token", async () => {
    const endpoint = getRegisteredEndpoint();
    expect(
      parse(await endpoint.init({ headers: {}, data: { op: "ping" } })),
    ).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
    expect(
      parse(
        await endpoint.init({
          headers: { "x-zinspire-read-token": "WRONG" },
          data: { op: "ping" },
        }),
      ),
    ).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
  });

  it("keeps the write token isolated and accepts only the read token", async () => {
    const endpoint = getRegisteredEndpoint();
    const writeOnly = parse(
      await endpoint.init({
        headers: { "x-zinspire-token": "WRITE-TOKEN" },
        data: { op: "ping" },
      }),
    );
    expect(writeOnly).toMatchObject({
      status: 403,
      body: { code: "FORBIDDEN" },
    });

    const writeTokenInReadHeader = parse(
      await endpoint.init({
        headers: { "x-zinspire-read-token": "WRITE-TOKEN" },
        data: { op: "ping" },
      }),
    );
    expect(writeTokenInReadHeader.status).toBe(403);

    const accepted = parse(
      await endpoint.init({
        headers: { "X-ZInspire-Read-Token": "READ-TOKEN" },
        data: { op: "ping" },
      }),
    );
    expect(accepted).toMatchObject({ status: 200, body: { ok: true } });
    expect(mocks.readExternalReadToken).toHaveBeenCalledTimes(3);
  });
});

describe("connector endpoint registration lifecycle", () => {
  it("registers idempotently", () => {
    registerZInspireBibtexEndpoint();
    const first = (Zotero as any).Server.Endpoints[
      INSPIRE_BIBTEX_ENDPOINT_PATH
    ];
    registerZInspireBibtexEndpoint();
    expect((Zotero as any).Server.Endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH]).toBe(
      first,
    );
    expect(Zotero.debug as any).toHaveBeenCalledTimes(1);
  });

  it("restores an endpoint that existed before registration", () => {
    class PreviousOwner {}
    const endpoints = (Zotero as any).Server.Endpoints;
    endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH] = PreviousOwner;

    registerZInspireBibtexEndpoint();
    expect(endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH]).not.toBe(PreviousOwner);
    unregisterZInspireBibtexEndpoint();
    expect(endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH]).toBe(PreviousOwner);
  });

  it("does not clobber a later owner on unregister", () => {
    class LaterOwner {}
    const endpoints = (Zotero as any).Server.Endpoints;
    registerZInspireBibtexEndpoint();
    endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH] = LaterOwner;

    unregisterZInspireBibtexEndpoint();
    expect(endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH]).toBe(LaterOwner);
  });

  it("fails safely when Zotero.Server.Endpoints is missing", () => {
    (Zotero as any).Server = {};
    expect(() => registerZInspireBibtexEndpoint()).not.toThrow();
    expect(Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("Zotero.Server.Endpoints not available"),
    );
  });
});
