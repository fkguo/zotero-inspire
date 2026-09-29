// ─────────────────────────────────────────────────────────────────────────────
// JsonStateFile: a JSON file of state the plugin must not lose (unlike the
// cache, it cannot be fetched again), e.g. the arXiv browser's reading marks.
// The file carries a version. Writes go one after another, each replacing the
// file only once the new content is complete on disk (a temporary file first,
// as the preprint watch cache and Zotero's own files are written). A file that
// cannot be read, or has another version, is kept under another name for the
// caller to tell the user about; it is never overwritten with an empty state.
// When the file cannot be read at all (not even moved), nothing is written.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../package.json";

/** The plugin's folder in the Zotero data directory */
const PLUGIN_DATA_FOLDER = config.addonRef;

/** Path of a file in the plugin's folder of the Zotero data directory */
export function pluginDataPath(fileName: string): string {
  return PathUtils.join(Zotero.DataDirectory.dir, PLUGIN_DATA_FOLDER, fileName);
}

export type StateFileLoad<T> =
  /** No file yet */
  | { state: "none" }
  | { state: "read"; content: T }
  /** The file could not be read or has another version: kept as `keptAs` */
  | { state: "kept"; keptAs: string }
  /** The file could not be read nor kept aside: it is not written */
  | { state: "failed"; error: string };

export class JsonStateFile<T extends object> {
  private writable = false;
  /** A write is queued and has not started */
  private queued = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly version: number,
    /** The content of a file of this version, or null when it is not valid */
    private readonly parse: (data: Record<string, unknown>) => T | null,
  ) {}

  /** Read the file; writes are possible afterwards unless it failed */
  async load(): Promise<StateFileLoad<T>> {
    let text: string | null;
    try {
      text = (await IOUtils.exists(this.path))
        ? await IOUtils.readUTF8(this.path)
        : null;
    } catch (error) {
      return { state: "failed", error: String(error) };
    }
    if (text !== null) {
      let content: T | null = null;
      try {
        const data = JSON.parse(text);
        if (data?.version === this.version) content = this.parse(data);
      } catch {
        // Not JSON: kept aside below
      }
      if (!content) {
        try {
          const keptAs = await this.keepAside();
          this.writable = true;
          return { state: "kept", keptAs };
        } catch (error) {
          return { state: "failed", error: String(error) };
        }
      }
      this.writable = true;
      return { state: "read", content };
    }
    this.writable = true;
    return { state: "none" };
  }

  /**
   * Write `content()`, taken when the write starts: a save while another
   * waits is covered by the waiting one. Nothing is written before `load`,
   * nor after it failed.
   */
  save(content: () => T): Promise<void> {
    if (!this.writable || this.queued) return this.writes;
    this.queued = true;
    this.writes = this.writes.then(async () => {
      this.queued = false;
      try {
        await IOUtils.makeDirectory(PathUtils.parent(this.path)!, {
          ignoreExisting: true,
          createAncestors: true,
        });
        await IOUtils.writeJSON(
          this.path,
          { version: this.version, ...content() },
          { tmpPath: `${this.path}.tmp` },
        );
      } catch (error) {
        Zotero.debug(
          `[${config.addonName}] Could not write ${this.path}: ${error}`,
        );
      }
    });
    return this.writes;
  }

  /** Move the file to "<name>-unreadable-<time>.json" beside it */
  private async keepAside(): Promise<string> {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..*/, "");
    const keptAs = `${this.path.replace(/\.json$/, "")}-unreadable-${stamp}.json`;
    await IOUtils.move(this.path, keptAs, { noOverwrite: true });
    return keptAs;
  }
}
