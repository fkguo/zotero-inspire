// ─────────────────────────────────────────────────────────────────────────────
// Fakes for the preprint-watch tests: a Zotero with libraries, collections,
// items and searches by item type; the plugin's cache folder kept in memory
// (IOUtils / PathUtils); and INSPIRE answers keyed by arXiv ID.
// ─────────────────────────────────────────────────────────────────────────────

import { vi } from "vitest";

export type Fields = Record<string, string>;

export interface FakeItem {
  id: number;
  libraryID: number;
  key: string;
  itemType: string;
  deleted: boolean;
  fields: Fields;
  getField: (name: string) => string;
  setField: ReturnType<typeof vi.fn>;
  setType: ReturnType<typeof vi.fn>;
  saveTx: ReturnType<typeof vi.fn>;
  isRegularItem: () => boolean;
}

export interface FakeLibrary {
  libraryID: number;
  libraryType: "user" | "group" | "feed";
  editable: boolean;
  name: string;
}

export const CACHE_DIR = "/cache";
export const CACHE_FILE = `${CACHE_DIR}/preprintWatch.json`;

const ITEM_TYPE_IDS: Record<string, number> = {
  book: 7,
  journalArticle: 22,
  preprint: 36,
};

export class FakeZotero {
  libraries: FakeLibrary[] = [
    { libraryID: 1, libraryType: "user", editable: true, name: "My Library" },
  ];
  items = new Map<number, FakeItem>();
  collections = new Map<number, { libraryID: number; itemIDs: number[] }>();
  /** The cache folder: file path → stored JSON value */
  files = new Map<string, unknown>();
  /** Options of every IOUtils.writeJSON call, by file path */
  writeOptions: Array<{ path: string; options?: { tmpPath?: string } }> = [];
  /**
   * Time a write takes (ms); undefined: the file is written at once. Two
   * writes of one file at the same time leave it garbled, as two writers of
   * one temporary file would.
   */
  writeDelayMs: number | undefined;
  private writing = new Set<string>();
  /**
   * Libraries whose items Zotero has not loaded yet (a library is loaded when
   * it is first shown, or by waitForDataLoad("item")): reading a field of
   * their items throws, as Zotero's getField does
   */
  unloadedLibraries = new Set<number>();
  /** Number of Zotero.Search runs and of item IDs loaded through Items.getAsync */
  searchCount = 0;
  loadedItemCount = 0;
  mainWindow: any = null;
  selectedItems: FakeItem[] = [];
  selectedCollectionID: number | null = null;
  private nextID = 1;

  addItem(
    itemType: string,
    fields: Fields,
    options: { libraryID?: number; deleted?: boolean } = {},
  ): FakeItem {
    const id = this.nextID++;
    const item: FakeItem = {
      id,
      libraryID: options.libraryID ?? 1,
      key: `KEY${id}`,
      itemType,
      deleted: options.deleted ?? false,
      fields: { ...fields },
      getField: (name: string) => {
        if (this.unloadedLibraries.has(item.libraryID)) {
          throw new Error(`Item data not loaded and field '${name}' not set`);
        }
        return item.fields[name] ?? "";
      },
      setField: vi.fn((name: string, value: unknown) => {
        item.fields[name] = String(value);
      }),
      setType: vi.fn((typeID: number) => {
        const name = Object.keys(ITEM_TYPE_IDS).find(
          (type) => ITEM_TYPE_IDS[type] === typeID,
        );
        if (name) item.itemType = name;
      }),
      saveTx: vi.fn(async () => true),
      isRegularItem: () => true,
    };
    this.items.set(id, item);
    return item;
  }

  addCollection(id: number, items: FakeItem[], libraryID = 1): void {
    this.collections.set(id, {
      libraryID,
      itemIDs: items.map((item) => item.id),
    });
  }

  /** A library as Zotero.Libraries returns it */
  zoteroLibrary(library: FakeLibrary) {
    return {
      ...library,
      waitForDataLoad: async (objectType: string) => {
        if (objectType === "item")
          this.unloadedLibraries.delete(library.libraryID);
      },
    };
  }

  /** Stub the globals Zotero, IOUtils and PathUtils with this fake */
  install(): void {
    const fake = this;
    class Search {
      private conditions: Array<[string, string, string]> = [];
      constructor(private options: { libraryID: number }) {}
      addCondition(field: string, operator: string, value: string) {
        this.conditions.push([field, operator, value]);
      }
      async search(): Promise<number[]> {
        fake.searchCount++;
        return [...fake.items.values()]
          .filter(
            (item) =>
              item.libraryID === this.options.libraryID &&
              !item.deleted &&
              this.conditions.every(([field, operator, value]) =>
                field === "itemType"
                  ? item.itemType === value
                  : operator === "contains"
                    ? item.getField(field).includes(value)
                    : item.getField(field) === value,
              ),
          )
          .map((item) => item.id);
      }
    }
    vi.stubGlobal("Zotero", {
      debug: vi.fn(),
      Libraries: {
        userLibraryID: 1,
        getAll: () =>
          fake.libraries.map((library) => fake.zoteroLibrary(library)),
        get: (libraryID: number) => {
          const library = fake.libraries.find(
            (candidate) => candidate.libraryID === libraryID,
          );
          return library ? fake.zoteroLibrary(library) : false;
        },
      },
      Search,
      Items: {
        getAsync: async (ids: number | number[]) => {
          if (!Array.isArray(ids)) {
            fake.loadedItemCount++;
            return fake.items.get(ids) ?? false;
          }
          fake.loadedItemCount += ids.length;
          return ids
            .map((id) => fake.items.get(id))
            .filter((item): item is FakeItem => !!item);
        },
      },
      Collections: {
        getAsync: async (id: number) => {
          const collection = fake.collections.get(id);
          if (!collection) return false;
          return {
            id,
            libraryID: collection.libraryID,
            getChildItems: () =>
              collection.itemIDs
                .map((itemID) => fake.items.get(itemID)!)
                .filter((item) => !item.deleted),
          };
        },
      },
      ItemTypes: { getID: (name: string) => ITEM_TYPE_IDS[name] },
      getMainWindow: () => fake.mainWindow,
      getActiveZoteroPane: () => ({
        getSelectedItems: () => fake.selectedItems,
        getSelectedCollections: () => {
          const id = fake.selectedCollectionID;
          if (id === null) return [];
          const collection = fake.collections.get(id);
          return collection ? [{ id, libraryID: collection.libraryID }] : [];
        },
      }),
    });
    vi.stubGlobal("IOUtils", {
      exists: async (path: string) => fake.files.has(path),
      readJSON: async (path: string) => {
        if (!fake.files.has(path)) throw new Error(`No file ${path}`);
        return structuredClone(fake.files.get(path));
      },
      writeJSON: async (
        path: string,
        value: unknown,
        options?: { tmpPath?: string },
      ) => {
        fake.writeOptions.push({ path, options });
        // IOUtils serializes the value when called
        const content = structuredClone(value);
        if (fake.writeDelayMs === undefined) {
          fake.files.set(path, content);
          return;
        }
        const overlapping = fake.writing.has(path);
        fake.writing.add(path);
        await new Promise((resolve) => setTimeout(resolve, fake.writeDelayMs));
        fake.writing.delete(path);
        fake.files.set(path, overlapping ? "<garbled>" : content);
      },
      remove: async (path: string) => {
        fake.files.delete(path);
      },
      getChildren: async (dir: string) =>
        [...fake.files.keys()].filter((path) => path.startsWith(`${dir}/`)),
    });
    vi.stubGlobal("PathUtils", {
      join: (...parts: string[]) => parts.join("/"),
    });
  }
}

/** Metadata of an INSPIRE literature record, as the preprint check requests it */
export interface InspireMetadata {
  control_number?: number;
  arxiv_eprints?: Array<{ value: string; categories?: string[] }>;
  publication_info?: Array<Record<string, unknown>>;
  dois?: Array<{ value: string }>;
  preprint_date?: string;
}

export function inspireResponse(
  records: InspireMetadata[],
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () =>
      status >= 200 && status < 300
        ? {
            hits: {
              total: records.length,
              hits: records.map((metadata) => ({ metadata })),
            },
          }
        : { message: "failed" },
  } as unknown as Response;
}

/** The arXiv ID that a preprint-check request asks INSPIRE about */
export function requestedArxivId(url: string): string {
  const query = new URL(url).searchParams.get("q") ?? "";
  return query.replace(/^eprint:/, "");
}

/**
 * INSPIRE answers by arXiv ID for a mocked inspireFetch: a list of records,
 * an HTTP status for a failed request, or an Error for a network failure.
 */
export function inspireAnswers(
  answers: Map<string, InspireMetadata[] | number | Error>,
) {
  return (url: string) => {
    const answer = answers.get(requestedArxivId(url));
    if (answer instanceof Error) return Promise.reject(answer);
    if (typeof answer === "number") {
      return Promise.resolve(inspireResponse([], answer));
    }
    return Promise.resolve(inspireResponse(answer ?? []));
  };
}

/** A promise with its resolve function, for requests answered by a test */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/** A published record: journal information plus the journal DOI */
export function publishedRecord(
  arxivId: string,
  recid: number,
  journal = "Phys.Rev.D",
): InspireMetadata {
  return {
    control_number: recid,
    arxiv_eprints: [{ value: arxivId }],
    publication_info: [
      {
        journal_title: journal,
        journal_volume: "110",
        artid: "014001",
        year: 2025,
      },
    ],
    dois: [{ value: `10.1103/PhysRevD.110.${recid}` }],
    preprint_date: "2024-01-15",
  };
}

/** A record of a paper that has not appeared in a journal */
export function unpublishedRecord(
  arxivId: string,
  recid: number,
): InspireMetadata {
  return {
    control_number: recid,
    arxiv_eprints: [{ value: arxivId }],
    preprint_date: "2024-01-15",
  };
}
