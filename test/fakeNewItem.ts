// ─────────────────────────────────────────────────────────────────────────────
// Zotero.Item for tests of code that creates items: records what the code
// sets (type, library, fields, creators, collections, tags, note) and each
// save with its options. Installed on the stubbed Zotero global.
// ─────────────────────────────────────────────────────────────────────────────

/** Fields each type lacks, of those the plugin writes (Zotero's schema) */
const MISSING_FIELDS: Record<string, string[]> = {
  preprint: [
    "journalAbbreviation",
    "publicationTitle",
    "volume",
    "issue",
    "pages",
  ],
  journalArticle: ["archiveID", "repository"],
};

export class FakeNewItem {
  /** Every item created since installFakeNewItems, in order */
  static created: FakeNewItem[] = [];
  static nextID = 9001;

  id?: number;
  libraryID?: number;
  parentID?: number;
  itemType: string;
  fields: Record<string, string> = {};
  creators: any[] = [];
  collections: number[] = [];
  tags: string[] = [];
  noteText?: string;
  /** Options of each save */
  saves: unknown[] = [];
  /** Own properties set on the item (plugin marks) at each save */
  marksAtSave: string[][] = [];

  constructor(itemType: string) {
    this.itemType = itemType;
    FakeNewItem.created.push(this);
  }

  /** Like Zotero, refuses a value for a field the item's type lacks */
  setField(name: string, value: string) {
    if (value && MISSING_FIELDS[this.itemType]?.includes(name)) {
      throw new Error(`'${name}' is not a field of ${this.itemType}`);
    }
    this.fields[name] = value;
  }
  getField(name: string) {
    return this.fields[name] ?? "";
  }
  setCreators(creators: any[]) {
    this.creators = creators;
  }
  getCreators() {
    return this.creators;
  }
  setCollections(ids: number[]) {
    this.collections = ids;
  }
  addTag(tag: string) {
    if (this.tags.includes(tag)) return false;
    this.tags.push(tag);
    return true;
  }
  hasTag(tag: string) {
    return this.tags.includes(tag);
  }
  /** Item data in Zotero's JSON form (Zotero.Item#fromJSON, simplified) */
  fromJSON(json: Record<string, any>) {
    this.itemType = json.itemType;
    for (const [key, value] of Object.entries(json)) {
      if (key === "itemType") continue;
      if (key === "creators") this.creators = value;
      else if (key === "tags") this.tagData = value;
      else this.setField(key, value);
    }
  }
  /** Tags given to fromJSON, with their types */
  tagData: { tag: string; type?: number }[] = [];
  setNote(text: string) {
    this.noteText = text;
  }
  isRegularItem() {
    return !["note", "attachment", "annotation"].includes(this.itemType);
  }
  async saveTx(options?: unknown) {
    this.saves.push(options);
    this.marksAtSave.push(
      Object.keys(this).filter((key) => key.startsWith("_zinspire")),
    );
    this.id ??= FakeNewItem.nextID++;
    return this.id;
  }
}

/** Make `new Zotero.Item(type)` create FakeNewItems (Zotero already stubbed) */
export function installFakeNewItems(): void {
  FakeNewItem.created = [];
  (globalThis as any).Zotero.Item = FakeNewItem;
}
