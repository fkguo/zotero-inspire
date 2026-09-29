import { vi } from "vitest";

/**
 * Gecko's IOUtils and PathUtils over files in memory, for the calls the
 * plugin's state files make. `writeJSON` with a `tmpPath` writes the
 * temporary file and then moves it over the file, as IOUtils does.
 */
export function fakeFiles(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const failing = new Set<string>();
  const check = (path: string) => {
    if (failing.has(path)) throw new Error(`NotReadableError: ${path}`);
  };
  const IOUtils = {
    exists: vi.fn(async (path: string) => {
      check(path);
      return files.has(path);
    }),
    readUTF8: vi.fn(async (path: string) => {
      check(path);
      const text = files.get(path);
      if (text === undefined) throw new Error(`NotFoundError: ${path}`);
      return text;
    }),
    writeJSON: vi.fn(
      async (path: string, value: unknown, options?: { tmpPath?: string }) => {
        const text = JSON.stringify(value);
        if (options?.tmpPath) {
          files.set(options.tmpPath, text);
          files.delete(options.tmpPath);
        }
        files.set(path, text);
        return text.length;
      },
    ),
    move: vi.fn(
      async (from: string, to: string, options?: { noOverwrite?: boolean }) => {
        check(from);
        if (options?.noOverwrite && files.has(to)) {
          throw new Error(`NoModificationAllowedError: ${to}`);
        }
        const text = files.get(from);
        if (text === undefined) throw new Error(`NotFoundError: ${from}`);
        files.set(to, text);
        files.delete(from);
      },
    ),
    makeDirectory: vi.fn(async () => undefined),
  };
  const PathUtils = {
    join: (...parts: string[]) => parts.join("/"),
    parent: (path: string) => path.slice(0, path.lastIndexOf("/")) || null,
  };
  vi.stubGlobal("IOUtils", IOUtils);
  vi.stubGlobal("PathUtils", PathUtils);
  return {
    files,
    IOUtils,
    /** Reading or moving `path` fails (a file that cannot be opened) */
    unreadable: (path: string) => failing.add(path),
  };
}
