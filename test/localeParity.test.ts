import { readdirSync, readFileSync } from "node:fs";
import {
  FluentParser,
  Junk,
  Message,
  Term,
  Visitor,
  type Resource,
  type VariableReference,
} from "@fluent/syntax";
import { describe, expect, it } from "vitest";

// A message that a locale lacks, or that Fluent cannot parse there, is shown
// in English (Fluent falls back to en-US). So every .ftl file must parse and
// define each message once, and every locale must define the same messages as
// en-US, each with the same parts: a value, attributes and the variables they
// use. Whether a translation is worded well is not checked here.

const LOCALE_DIR = new URL("../addon/locale/", import.meta.url);
const REFERENCE = "en-US";
// The locales the plugin ships; any other locale directory is checked too.
const SHIPPED = [REFERENCE, "zh-CN"];
const LOCALES = readdirSync(LOCALE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const ftlFiles = (locale: string) =>
  readdirSync(new URL(`${locale}/`, LOCALE_DIR)).filter((name) =>
    name.endsWith(".ftl"),
  );

function parse(locale: string, file: string): Resource {
  const text = readFileSync(new URL(`${locale}/${file}`, LOCALE_DIR), "utf8");
  return new FluentParser({ withSpans: false }).parse(text);
}

// Names of the variables used anywhere in a message, e.g. "$count"
class VariableNames extends Visitor {
  names = new Set<string>();
  visitVariableReference(node: VariableReference) {
    this.names.add(`$${node.id.name}`);
  }
}

// Each message ID with the parts it defines: "value" if it has a value, then
// ".name" for each attribute, then the variables it uses.
function messageParts(resource: Resource): Map<string, string> {
  const parts = new Map<string, string>();
  for (const entry of resource.body) {
    if (!(entry instanceof Message)) continue;
    const names = entry.attributes
      .map((attribute) => `.${attribute.id.name}`)
      .sort();
    if (entry.value) names.unshift("value");
    const variables = new VariableNames();
    variables.visit(entry);
    names.push(...[...variables.names].sort());
    parts.set(entry.id.name, names.join(" "));
  }
  return parts;
}

describe("locale files", () => {
  it("finds the locales and files to compare", () => {
    expect(LOCALES).toEqual(expect.arrayContaining(SHIPPED));
    expect(ftlFiles(REFERENCE).length).toBeGreaterThan(0);
  });

  it.each(
    LOCALES.flatMap((locale) => ftlFiles(locale).map((file) => [locale, file])),
  )("%s/%s parses and defines each message once", (locale, file) => {
    const body = parse(locale, file).body;
    // First line of each entry Fluent could not parse
    const unparsed = body
      .filter((entry) => entry instanceof Junk)
      .map((entry) => (entry as Junk).content.split("\n")[0]);
    // Fluent uses only one of several definitions of a message or term
    const ids = body.flatMap((entry) =>
      entry instanceof Message
        ? [entry.id.name]
        : entry instanceof Term
          ? [`-${entry.id.name}`]
          : [],
    );
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect({ unparsed, duplicated }).toEqual({ unparsed: [], duplicated: [] });
  });

  it.each(
    LOCALES.filter((locale) => locale !== REFERENCE).flatMap((locale) =>
      ftlFiles(REFERENCE).map((file) => [locale, file]),
    ),
  )("%s/%s defines the same messages as en-US", (locale, file) => {
    expect(ftlFiles(locale)).toContain(file);
    const reference = messageParts(parse(REFERENCE, file));
    const messages = messageParts(parse(locale, file));
    expect(reference.size).toBeGreaterThan(0);
    const missing = [...reference.keys()].filter((id) => !messages.has(id));
    const extra = [...messages.keys()].filter((id) => !reference.has(id));
    const partsDiffer = [...reference]
      .filter(([id, parts]) => messages.has(id) && messages.get(id) !== parts)
      .map(([id, parts]) => `${id}: ${parts} / ${messages.get(id)}`);
    expect({ missing, extra, partsDiffer }).toEqual({
      missing: [],
      extra: [],
      partsDiffer: [],
    });
  });
});
