import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonStateFile } from "../src/utils/jsonStateFile";
import { fakeFiles } from "./fakeFiles";

// A JSON file of state the plugin must not lose: versioned, written whole
// (through a temporary file) one write after another, and an unreadable file
// kept aside rather than overwritten.

const PATH = "/data/zoteroinspire/state.json";

interface Content {
  names: string[];
}
const parse = (data: Record<string, unknown>): Content | null =>
  Array.isArray(data.names) ? { names: data.names as string[] } : null;
const stateFile = () => new JsonStateFile<Content>(PATH, 2, parse);

beforeEach(() => {
  vi.stubGlobal("Zotero", { debug: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("JSON state file", () => {
  it("reads the content of a file of its version, and writes it back with the version", async () => {
    const disk = fakeFiles({
      [PATH]: JSON.stringify({ version: 2, names: ["a"] }),
    });
    const file = stateFile();
    expect(await file.load()).toEqual({
      state: "read",
      content: { names: ["a"] },
    });
    await file.save(() => ({ names: ["a", "b"] }));
    expect(JSON.parse(disk.files.get(PATH)!)).toEqual({
      version: 2,
      names: ["a", "b"],
    });
    // Through a temporary file, replaced only once complete
    expect(disk.IOUtils.writeJSON).toHaveBeenCalledWith(
      PATH,
      expect.anything(),
      { tmpPath: `${PATH}.tmp` },
    );
  });

  it("starts empty without a file, and creates it on the first write", async () => {
    const disk = fakeFiles();
    const file = stateFile();
    expect(await file.load()).toEqual({ state: "none" });
    await file.save(() => ({ names: [] }));
    expect(JSON.parse(disk.files.get(PATH)!)).toEqual({
      version: 2,
      names: [],
    });
  });

  it("keeps a corrupt file under another name and never overwrites it", async () => {
    const corrupt = '{"version": 2, "names": ["a"';
    const disk = fakeFiles({ [PATH]: corrupt });
    const file = stateFile();
    const loaded = await file.load();
    expect(loaded.state).toBe("kept");
    const keptAs = loaded.state === "kept" ? loaded.keptAs : "";
    expect(keptAs).toMatch(
      /^\/data\/zoteroinspire\/state-unreadable-\d{8}T\d{6}\.json$/,
    );
    expect(disk.files.get(keptAs)).toBe(corrupt);
    // Later writes go to a new file; the kept one is untouched
    await file.save(() => ({ names: ["b"] }));
    expect(disk.files.get(keptAs)).toBe(corrupt);
    expect(JSON.parse(disk.files.get(PATH)!).names).toEqual(["b"]);
  });

  it("keeps a file of another version, or of the wrong shape, the same way", async () => {
    for (const text of [
      JSON.stringify({ version: 3, names: ["a"] }),
      JSON.stringify({ version: 2, names: "a" }),
      "null",
    ]) {
      const disk = fakeFiles({ [PATH]: text });
      const loaded = await stateFile().load();
      expect(loaded.state).toBe("kept");
      if (loaded.state === "kept") {
        expect(disk.files.get(loaded.keptAs)).toBe(text);
      }
      expect(disk.files.has(PATH)).toBe(false);
    }
  });

  it("writes nothing when the file cannot be read at all", async () => {
    const disk = fakeFiles({
      [PATH]: JSON.stringify({ version: 2, names: ["a"] }),
    });
    disk.unreadable(PATH);
    const file = stateFile();
    expect((await file.load()).state).toBe("failed");
    await file.save(() => ({ names: [] }));
    expect(disk.IOUtils.writeJSON).not.toHaveBeenCalled();
  });

  it("writes nothing before the file is read", async () => {
    const disk = fakeFiles();
    await stateFile().save(() => ({ names: [] }));
    expect(disk.IOUtils.writeJSON).not.toHaveBeenCalled();
  });

  it("writes one after another, a save while one waits taking the content when it starts", async () => {
    const disk = fakeFiles();
    let finish: () => void = () => undefined;
    let running = 0;
    let most = 0;
    disk.IOUtils.writeJSON.mockImplementation(async (path, value) => {
      running++;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => (finish = resolve));
      running--;
      disk.files.set(path, JSON.stringify(value));
      return 0;
    });
    const file = stateFile();
    await file.load();
    const names = ["a"];
    const first = file.save(() => ({ names: [...names] }));
    await vi.waitFor(() => expect(running).toBe(1));
    names.push("b");
    file.save(() => ({ names: [...names] }));
    names.push("c");
    const last = file.save(() => ({ names: [...names] }));
    finish();
    await first;
    await vi.waitFor(() => expect(running).toBe(1));
    finish();
    await last;
    expect(most).toBe(1);
    // The first write, and one more with everything saved while it ran
    expect(disk.IOUtils.writeJSON).toHaveBeenCalledTimes(2);
    expect(JSON.parse(disk.files.get(PATH)!).names).toEqual(["a", "b", "c"]);
  });
});
