# Zotero INSPIRE References

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

A Zotero plugin that integrates [INSPIRE-HEP](https://inspirehep.net), a community maintained database for **high energy physics and related fields**, into your reference management workflow. Browse references, citations, and author papers directly in Zotero without leaving your library.

> 📖 **[中文功能说明](docs/FEATURES_CN.md)** | **[Technical Reference](docs/FEATURES_REFERENCE.md)**

---

## Installation

### From Release

1. Download the latest `.xpi` file from [Releases](https://github.com/fkguo/zotero-inspire/releases/)
2. In Zotero: `Tools` → `Plugins` → click gear icon → `Install Plugin From File...`
3. Select the downloaded `.xpi` file

### From Source

```bash
git clone https://github.com/fkguo/zotero-inspire.git
cd zotero-inspire
npm install
npm run build
```

Then install `build/*.xpi` as above.

---

## Quick Start

### Update Metadata from INSPIRE

**Right-click any item** → `INSPIRE`:

- **`With abstracts`** — Full metadata including abstract
- **`Without abstracts`** — Skip abstract field
- **`Citation counts only`** — Just update citation numbers

The plugin automatically fetches metadata when you add new items (configurable in Preferences).

### Copy Actions

**Right-click any item** → `INSPIRE` for quick copy options:

- **`Copy BibTeX`** — Fetch and copy BibTeX from INSPIRE
- **`Copy citation key`** — Copy the INSPIRE texkey
- **`Copy INSPIRE link`** — Copy the INSPIRE literature URL
- **`Copy INSPIRE link (markdown)`** — Copy the INSPIRE literature URL in format of `[texkey](link)`
- **`Copy Zotero link`** — Copy Zotero select link
- **`Copy Funding Info`** — Extract and copy funding information from PDF acknowledgments

### Browse References Panel

Select an item with an INSPIRE record, then find the **INSPIRE** section in the right panel:

| Tab                     | What it shows                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **References**    | Papers cited by this item                                                                                  |
| **Cited by**      | Papers that cite this item                                                                                 |
| **Related**       | Recommended papers based on shared references (bibliographic coupling)                                     |
| **Entry Cited**   | Papers citing a specific reference, appears only after clicking the `Cited by ...` button below an entry |
| **Author Papers** | All papers by a clicked author, appears only after clicking an author name                                 |
| **🔍 Search**     | INSPIRE search results                                                                                     |
| **⭐ Favorites**   | Your favorite authors and papers                                                                           |

Note: Related-paper discovery ignores the PDG "Review of Particle Physics" reference as a seed anchor (it is cited by most HEP papers and usually hurts relevance).
Citation Graph: a 1-hop visualization (refs/cited-by capped at 50); click nodes to open INSPIRE, right-click to expand (re-root).

### Search INSPIRE

**From Zotero's search bar**: Type `inspire:` followed by your query and press Enter.

```
inspire: a Witten           → Search by author
inspire: t quark mass       → Search by title
inspire: arXiv:2305.12345   → Search by arXiv ID
inspire: j Phys.Rev.D       → Search by journal
```

**From the panel (more convenient)**: Click the 🔍 Search tab and enter your query directly (no prefix needed). Search history is saved and accessible via dropdown (use right or tab to accept inline hint from history records).

### Custom Columns (Main Item List)

Zotero's main item list supports two additional columns:

- **`Cites`** — Citation counts from INSPIRE (stored in `Extra` by this plugin). Default: includes self-citations (configurable).
- **`arXiv`** — arXiv ID extracted locally (from Journal Abbr. / Extra / URL / DOI).

Enable them via the column picker in the items list header. Preferences:

- **Cites column: exclude self-citations** — Switch between total vs. without self-citations. If the list doesn't update immediately, switch collections or restart Zotero.
- **Legacy: write arXiv ID into Journal Abbr.** — Disabled by default now that an `arXiv` column exists (kept for backward compatibility).

---

## Panel Features

### Status Indicators

| Icon        | Meaning                       |
| ----------- | ----------------------------- |
| ● (green)  | Item exists in your library   |
| ⊕ (red)    | Item can be imported          |
| 🔗 (green)  | Linked as related item        |
| 🔗 (gray)   | Not linked                    |
| 📄 (green)  | PDF available - click to open |
| ⬇️ (blue) | Find Full Text available      |
| 📄 (gray)   | No PDF / Not in library       |

### Interactions

| Action               | Result                   |
| -------------------- | ------------------------ |
| Click ●             | Jump to local item       |
| Double-click ●      | Open PDF directly        |
| Click ⊕             | Open import dialog       |
| Click 🔗             | Toggle related item link |
| Click 📄 (green)     | Open PDF attachment      |
| Click ⬇️ (blue)    | Trigger Find Full Text   |
| Click title          | Open in INSPIRE          |
| Hover title          | Show abstract            |
| Click author         | View author's papers     |
| Hover author         | Show author profile      |
| Click citation count | View citing papers       |
| Click 📋             | Copy BibTeX              |
| Click T              | Copy citation key        |
| Right-click entry    | Context menu (Favorites) |

### Filtering & Sorting

- **Text filter**: Type keywords to filter entries; supports multi-word, phrase search (`"exact phrase"`), journal abbreviations (`"PRL"`, `"PRD"`, `"JHEP"`, etc.), and international characters (ä→ae)
- **Quick filters**: Click the Filters button for presets (high citations, recent papers, published only, etc.)
- **Sort options**: INSPIRE order, relevance (Related tab), newest first, or most cited first
- **Chart filters**: Click bars in the statistics chart to filter by year or citation range; Ctrl/Cmd+click for multi-select

### Navigation

- **Back/Forward**: Use the ← → buttons to navigate between previously viewed items, like browser history
- **Keyboard**: Arrow keys, Home/End, and vim-style j/k navigation (see Keyboard Shortcuts)

### Favorites

The **⭐ Favorites** tab lets you quickly access your favorite authors, papers, and presentations:

- **Favorite Authors**: Click the star (☆/★) button in the Author Papers tab or author preview card to add authors to favorites
- **Favorite Papers & Presentations**: Right-click any entry within the INSPIRE References panel and select "Add paper to favorites" (or "Add presentation to favorites"), or use the right-click menu in Zotero's main window. Items of type "Presentation" are automatically categorized under "Favorite Presentations".
- **Quick Access**: All favorites are displayed in the Favorites tab with drag-and-drop reordering within each category (Authors, Papers, Presentations)
- **Filtering**: Use the text filter to search within your favorites

### Batch Operations

1. Use checkboxes to select multiple entries
2. Click **Import** to batch import selected items
3. The plugin detects duplicates automatically before importing

### Export Options

Click the export button in the toolbar:

- **Copy to Clipboard** — BibTeX, LaTeX (US), or LaTeX (EU) format
- **Copy citation keys** — Comma-separated keys for `\cite{}`
- **Export to File** — Save as `.bib` or `.tex` file
- **Select Citation Style...** — Export using any Zotero citation style

---

## PDF Reader Integration

When reading a PDF in Zotero:

1. **Select text containing citations** (e.g., "see Refs. [1,2,3]")
2. **Hover** over the **INSPIRE Refs. [n]** button to preview the reference (title, authors, abstract)
3. **Click** to jump to and highlight the corresponding reference in the panel

**Supported formats**: `[1]`, `[1,2,3]`, `[1-5]`, `[Smith 2024]`, `[arXiv:2301.12345]`, superscripts

---

## Keyboard Shortcuts

| Key                  | Action             |
| -------------------- | ------------------ |
| `↑` / `k`       | Previous entry     |
| `↓` / `j`       | Next entry         |
| `←` / `→`      | Navigate history   |
| `Home` / `End`   | Jump to first/last |
| `Enter`            | Open PDF or import |
| `Space` / `l`    | Toggle link        |
| `Tab`              | Next tab           |
| `Ctrl/Cmd+Shift+C` | Copy BibTeX        |
| `Escape`           | Clear selection    |

---

## Tips & Tricks

### Funding Information Extraction

Extract grant numbers from PDF acknowledgment sections for reporting:

1. Select one or more items with PDF attachments
2. Right-click → `INSPIRE` → `Copy Funding Info`
3. Paste into your funding report

**Output format** (single item): `NSFC: 12345678; DOE: SC0012345`
**Output format** (multiple items): Tab-separated table with Title, arXiv, Funding columns

**Supported funders** include: NSFC, MoST, CAS, DOE, NSF (US), ERC, DFG, JSPS, and many more.

> **Note**: Extraction results may be incomplete due to PDF text quality, non-standard acknowledgment formats, or unrecognized funder patterns. Please verify manually for critical use cases.

### Offline Usage

Right-click items or collections → `INSPIRE` → `Download references cache` to prefetch data for offline viewing.

### Preprint Monitoring

Enable **Preprint Watch** in Preferences to automatically check if your arXiv preprints have been published.

### Smart Update Mode

Enable **Smart Update** in Preferences to preserve your manual edits when updating metadata. You can protect specific fields (title, authors, abstract, journal) and author names with diacritics.

### Better BibTeX Integration

The plugin automatically sets INSPIRE citation keys in the Extra field, which Better BibTeX can use for pinning.

### INSPIRE Lookup Engine

Add this to your Zotero `engines.json` for quick INSPIRE lookups:

```json
{
  "_name": "INSPIRE",
  "_alias": "INSPIRE",
  "_description": "INSPIRE",
  "_icon": "https://inspirehep.net/favicon.ico",
  "_hidden": false,
  "_urlTemplate": "https://inspirehep.net/literature/{z:archiveLocation}"
}
```

---

## Preferences

Access via `Tools` → `Add-ons` → `INSPIRE Metadata Updater` → `Preferences`:

| Setting                            | Description                                    |
| ---------------------------------- | ---------------------------------------------- |
| **Auto-fetch for new items** | Fetch metadata automatically when adding items |
| **Citation key in Extra**    | Write INSPIRE texkey to Extra field            |
| **Max authors**              | Number of authors shown before "et al."        |
| **Statistics chart**         | Show year/citation distribution chart          |
| **Local cache**              | Enable persistent disk cache for offline use   |
| **Smart Update**             | Preserve manual edits during updates           |
| **Preprint Watch**           | Monitor unpublished preprints                  |
| **Fuzzy citation detection** | For PDFs with broken text layers               |
| **Abstract LaTeX mode**      | KaTeX (full rendering, default) or Unicode     |

---

## Troubleshooting

**Item not found in INSPIRE?**

- Ensure the item has a DOI, arXiv ID, or INSPIRE recid
- Check the Extra field for `arXiv:` or `Citation Key:` entries

**Panel not showing?**

- The item needs an INSPIRE record ID (shown in "Loc. in Archive" field)
- Try updating metadata first to fetch the record ID

**Citation counts not updating?**

- Use `Update Metadata` → `Citation counts only` from the right-click menu
- Falls back to CrossRef if INSPIRE record not found

---

## License

Mozilla Public License (MPL) Version 2.0

---

## Acknowledgments

Built with [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template). Inspired by [zotero-shortdoi](https://github.com/bwiernik/zotero-shortdoi) and [zotero-citationcounts](https://github.com/eschnett/zotero-citationcounts).
