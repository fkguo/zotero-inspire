# Zotero 11 beta compatibility

Zotero 11 preparation is in progress. The supported release remains Zotero 10;
the plugin version remains 4.1.2 and `strict_max_version` remains `10.*`.
No new release or updater change is part of this preparation.

[Zotero's developer guidance](https://www.zotero.org/support/dev/zotero_11_for_developers)
asks plugins to wait for the feature-freeze announcement before declaring Zotero
11 compatibility. Beta, dev and source builds accept plugins whose maximum
version is lower, so testing does not require widening the release manifest.

## Platform changes

The arXiv HTML pane now omits the initial `remote` attribute. On Firefox 153,
`remote="false"` also creates a remote browser because the attribute is checked
for presence. Omitting it starts the browser non-remote on both platforms;
`maychangeremoteness="true"` still allows navigation into a content process.
The HTML-pane regression test checks that the attribute is absent.

The source and production bundle were also checked for the removed
`ownerGlobal` property, `CheckboxStateChange` event, lazy service getters using
interface names, synchronous login access, false-valued XUL boolean attributes
and writes to built-in objects. No additional affected usage was found. INSPIRE
menus already use `Zotero.MenuManager`, with explicit image attributes and
`list-style-image` for macOS native menus.

## Checked beta

Initial checks used macOS arm64 Zotero **11.0-beta.1+b551fb670**, build
**20261009134240**, based on Firefox **153**, with a separate profile and empty
library. The plugin retained its `10.*` maximum version throughout testing.

| Area                                        | Result                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Plugin activation, startup and localization | Passed                                                                                   |
| Item, collection and PDF-tab INSPIRE menus  | Registered and generated successfully                                                    |
| Menu icons                                  | PNG image attributes present; visual comparison pending                                  |
| PDF-tab commands                            | Enabled for a PDF attachment with an INSPIRE parent; copying recid used that parent      |
| arXiv toolbar and browser window            | Button present and window content initialized                                            |
| HTML pane with a local document fixture     | Started non-remote, loaded in a content process, opened/closed find, cleaned up on close |
| Native PDF overlay optimization             | Remained disabled on the unsupported host                                                |

These are initial runtime checks, not a complete compatibility claim. Live
network behavior, real PDF citation interactions and menu appearance remain
outside the checks above. The TypeScript/build checks and the full unit suite
also passed: 2740 tests passed, 3 skipped.

## Remaining checks

- Compare menu icon appearance on macOS, Windows and Linux, in light and dark
  modes. DOM icon attributes alone do not establish the rendered appearance.
- Exercise live arXiv pages: loading, search, back/forward, citation links,
  selection cards and navigation between papers.
- Exercise PDF citation selection, hover cards and click navigation, including
  background tabs and multiple Reader windows.
- Check preferences, local connector endpoints, item-pane updates, disable,
  re-enable and upgrade behavior.
- Recheck the final Zotero 11 beta after the feature-freeze announcement before
  changing the declared compatibility range.

The optional native PDF citation-overlay reuse remains limited to its audited
Zotero 10 builds. Zotero 11 returns `unsupported-host`; its private Reader bridge
must be audited separately before enabling this optimization.

The arXiv window currently uses inline load/unload handlers. Zotero 11 currently
keeps these working by disabling the new chrome-document baseline CSP, but the
handlers should move into an external script before Zotero removes that
exception. See the same developer guidance for the temporary CSP setting.

## Testing safely

Use a separate Zotero profile **and** an empty data directory. Do not point a
beta at a production library or enable synchronization for the test profile.
Install a locally built XPI without changing its maximum-version declaration.
Use disposable paper and PDF fixtures when testing commands that modify items.

Keep the published `update.json` when building an unreleased candidate:
`npm run build` regenerates it through the postbuild step. A local compatibility
build must not replace the hash of the published XPI.
