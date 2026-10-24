import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);
const script = readFileSync(
  new URL(
    `../build/addon/content/scripts/${pkg.config.addonRef}.js`,
    import.meta.url,
  ),
  "utf8",
);

for (const marker of [
  /zotero:\/\/plugin/,
  /zotero:\/\/ztoolkit-debug/,
  /\bPluginBridge\b/,
  /\bDebugBridge\b/,
]) {
  assert.ok(!marker.test(script), `Unexpected toolkit bridge: ${marker}`);
}
console.log("Bundle check passed: no toolkit installation or debug bridges.");
