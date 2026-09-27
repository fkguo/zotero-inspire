#!/usr/bin/env node
// Generate src/modules/arxiv/arxivArchives.json, the table of arXiv archives
// that old-style identifiers (archive/YYMMNNN, 1991-07 to 2007-03) can name,
// from arXiv's own taxonomy, arxiv-base arxiv/taxonomy/definitions.py.
//
// The table keeps every archive of a non-test group that started before
// 2007-04, discontinued ones included (alg-geom, chao-dyn, q-alg, ...), and
// for each archive the subject classes of its categories (math.GT -> "GT"),
// which may follow the archive name in an identifier (math.GT/0309136).
//
// Usage (regenerate before each release):
//   node scripts/generate-arxiv-archives.mjs [--commit <sha>] [--file <path>]
// --commit selects the arxiv-base revision (default: the pinned one below);
// --file reads a local copy of definitions.py of that revision instead of
// downloading it.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_COMMIT = "a5985f621b07a4031c9e9b4f870a2206a9aa15a7";
const DEFINITIONS_PATH = "arxiv/taxonomy/definitions.py";
const OLD_SCHEME_END = "2007-04-01";
const OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "modules",
  "arxiv",
  "arxivArchives.json",
);

function parseArgs(argv) {
  const args = { commit: DEFAULT_COMMIT, file: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === "--commit" && value) {
      args.commit = value;
      i++;
    } else if (argv[i] === "--file" && value) {
      args.file = value;
      i++;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(args.commit)) {
    throw new Error(`--commit must be a full commit SHA: ${args.commit}`);
  }
  return args;
}

/** The text of `name: ... = {` up to the matching closing brace line. */
function dictBlock(source, name) {
  const start = source.search(new RegExp(`^${name}\\s*:[^=\\n]*=\\s*\\{`, "m"));
  if (start < 0) throw new Error(`${name} not found`);
  const end = source.indexOf("\n}", start);
  if (end < 0) throw new Error(`${name} is not closed`);
  return source.slice(start, end);
}

const VALUE =
  /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|True|False|None|date\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))/g;

function pyValue(text) {
  if (text === "True") return true;
  if (text === "False") return false;
  if (text === "None") return null;
  const date = text.match(/^date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (date) {
    const [, y, m, d] = date;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return text.slice(1, -1);
}

/** Entries `"key": Kind(field=value, ...)` of a dict block. */
function entries(block, kind) {
  const result = new Map();
  const entry = new RegExp(
    `"([^"]+)"\\s*:\\s*${kind}\\(([\\s\\S]*?)\\n\\s*\\)`,
    "g",
  );
  for (const [, key, body] of block.matchAll(entry)) {
    const fields = {};
    for (const [, name, value] of body.matchAll(VALUE)) {
      fields[name] = pyValue(value);
    }
    if (fields.id !== key) {
      throw new Error(`${kind} ${key}: id is ${JSON.stringify(fields.id)}`);
    }
    result.set(key, fields);
  }
  if (result.size === 0) throw new Error(`No ${kind} entries found`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = `https://raw.githubusercontent.com/arXiv/arxiv-base/${args.commit}/${DEFINITIONS_PATH}`;
  let source;
  if (args.file) {
    source = await readFile(args.file, "utf8");
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    source = await response.text();
  }

  const groups = entries(dictBlock(source, "GROUPS"), "Group");
  const archives = entries(dictBlock(source, "ARCHIVES"), "Archive");
  const categories = entries(dictBlock(source, "CATEGORIES"), "Category");

  const table = [];
  for (const archive of archives.values()) {
    const group = groups.get(archive.in_group);
    if (!group)
      throw new Error(`${archive.id}: unknown group ${archive.in_group}`);
    if (group.is_test) continue;
    if (!archive.start_date) throw new Error(`${archive.id}: no start_date`);
    if (archive.start_date >= OLD_SCHEME_END) continue;
    const subjectClasses = [...categories.values()]
      .filter(
        (category) =>
          category.in_archive === archive.id &&
          category.id.startsWith(`${archive.id}.`),
      )
      .map((category) => category.id.slice(archive.id.length + 1))
      .sort();
    table.push({
      id: archive.id,
      name: archive.full_name,
      active: archive.is_active,
      start: archive.start_date.slice(0, 7),
      ...(archive.end_date ? { end: archive.end_date.slice(0, 7) } : {}),
      subjectClasses,
    });
  }
  table.sort((a, b) => a.id.localeCompare(b.id));

  const output = {
    source: `https://github.com/arXiv/arxiv-base/blob/${args.commit}/${DEFINITIONS_PATH}`,
    generatedBy: "scripts/generate-arxiv-archives.mjs",
    archives: table,
  };
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`${table.length} archives written to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
