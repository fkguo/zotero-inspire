# Zotero INSPIRE References

[![zotero target version](https://img.shields.io/badge/Zotero-10-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![GitHub downloads, all releases](https://img.shields.io/github/downloads/fkguo/zotero-inspire/total?style=flat-square&logo=github&label=downloads)](https://github.com/fkguo/zotero-inspire/releases)

Zotero plugin with a Zotero-tailored arXiv browser and deep integration of [INSPIRE-HEP](https://inspirehep.net).

The **arXiv browser** works for every arXiv category, from mathematics and computer science to biology, economics and physics: read the daily listings in a Zotero window, then add papers to your library or relate them to items you already have. The **INSPIRE integration** serves high energy physics and related fields: browse references, citations, author papers and academic lineages directly in Zotero without leaving your library.

> 📖 **[中文功能说明](docs/FEATURES_CN.md)** | **[Technical Reference](docs/FEATURES_REFERENCE.md)**

## New features

**4.0.0** (requires Zotero 10):

- **[arXiv browser](#arxiv-browser)**: a separate Zotero window for reading arXiv listings of any field. Subscribe to any categories, pick announcement days in a calendar, read titles, authors and abstracts with rendered formulas, search arXiv, and add papers to your library (through INSPIRE when it has the paper, otherwise from arXiv's data) or relate them to your items.

Earlier:

- **[INSPIRE BibTeX export API](#read-only-inspire-bibtex)** for external tools such as [zotero-cite](https://github.com/fkguo/zotero-cite).
- **[Academic family tree](#explore-academic-tree-new-in-320)**: trace advisor–student relationships in the Academic Tree view.

<details>
<summary>Contents</summary>

- [Screenshots](#screenshots)
- [Installation](#installation)
- [arXiv Browser](#arxiv-browser)
  - [Getting started](#getting-started)
  - [Subscriptions and days](#subscriptions-and-days)
  - [Reading the list](#reading-the-list)
  - [Searching arXiv](#searching-arxiv)
  - [Adding papers to your library](#adding-papers-to-your-library)
  - [Relating papers to your items](#relating-papers-to-your-items)
  - [Copying and links](#copying-and-links)
  - [HTML version and snapshots](#html-version-and-snapshots)
  - [Requests to arXiv](#requests-to-arxiv)
- [INSPIRE Quick Start](#inspire-quick-start)
  - [Academic Tree](#explore-academic-tree-new-in-320)
- [Panel Features](#panel-features)
- [PDF Reader Integration](#pdf-reader-integration)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Tips & Tricks](#tips--tricks)
- [Preferences](#preferences)
- [Troubleshooting](#troubleshooting)
- [External APIs](#external-apis-for-local-tools)
  - [INSPIRE BibTeX export API](#read-only-inspire-bibtex)
- [License](#license)
- [Acknowledgments](#acknowledgments)

</details>

---

## Screenshots

### arXiv Browser

![arXiv browser window: subscription, category chips, day and search boxes, the list of papers and the detail pane with the HTML menu open](images/arxiv_browser.png)

### References Panel

![INSPIRE References panel screenshot](images/screenshot1.png)

### Connections Graph

![Connections Graph screenshot](images/citation_graph.png)

### Academic Tree

![Academic Tree view of the Connections Graph window](images/academic_tree.png)

## Installation

**Requires Zotero 10.** Version 3.2.5, the last release for Zotero 7 to 9, remains on the [Releases](https://github.com/fkguo/zotero-inspire/releases/) page.

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

## arXiv Browser

The arXiv browser is a Zotero window for reading arXiv's announcements. It is not limited to high energy physics: every arXiv category can be subscribed to, and papers that INSPIRE does not cover are added to your library from arXiv's own data.

**Open it** with `View` → `arXiv Browser`, with the arXiv button at the right end of Zotero's tab bar, or with the arXiv button (a red X on a dark tile) next to the INSPIRE button in the item pane's side navigation, also in the Reader. A second request brings the open window to the front. The window can also open when Zotero starts (see [Preferences](#preferences)).

### Getting started

1. **Subscribe**: click **New…**, name the subscription, and tick categories in the category picker (search by name or identifier, e.g. `math.AG` or `quantum`). Choose the sections to show (new submissions, cross-lists, replacements) and click **Save**.
2. **Pick days**: click the day button (it reads **Newest day ▾** at first) and choose a preset, or pick days in the calendar and click **Load**.
3. **Read**: move through the papers with `j` / `k`; the detail pane on the right shows the chosen paper with its abstract. `n` / `p` turn the page.
4. **Keep**: press `a` (or **Add…**) to add a paper, choosing the library or collection in the save-target picker; press `l` (or **Relate to items…**) to relate it to items in your library.

### Subscriptions and days

- **Subscriptions**: named sets of categories, managed with **New…**, **Edit…** and **Delete**; the window opens with the one chosen in Preferences (the first by default).
  - The category picker lists arXiv's groups, archives and categories with a search box. An archive with several categories can be taken whole ("All of …"), which costs one listing page instead of one per category.
  - The chosen categories are listed in the order you set; their listings are shown in that order.
  - The editor shows how many requests a first load takes and its minimum duration, and suggests a whole archive when more than 10 categories are chosen.
- **Category chips** under the subscription filter the list: click shows only that category, Ctrl/Cmd+click adds or removes one, Shift+click picks a range, and clicking the only chosen chip again shows all.
- **Calendar**: announcement days (Monday to Friday) within arXiv's last 90 days can be picked. Click picks one day, Ctrl/Cmd+click adds or removes a day, Shift+click picks a range. Picked days are fetched only when you click **Load**; the calendar shows how many requests that takes if the days are not cached.
- **Presets** load at once: **Newest day**, **Last 5 announcement days**, **This week**, **Unread days**.
- **Unread days**: a blue dot marks each announcement day not yet read in this subscription, counted from the day the subscription was made.
  - A day is marked read once its complete listing has been shown.
  - **Mark read** / **Mark unread** act on the picked days; **Mark all read** clears every dot without fetching anything.
  - Marks are kept per subscription for 100 days.

### Reading the list

- **Order of arrival**: the newest day is fetched and shown first. With several categories, a day appears as soon as its first category arrives, and the others are added as they come ("Still fetching: …" under the date). A category that failed gets **Retry**; a stopped load can be resumed with **Continue**.
- **Pages**: 50 papers per page by default (**Per page**, 10–500), with **‹ Previous**, page numbers and **Next ›**. The day chips above the list jump to a day.
- **Sort**: **Announcement order** (grouped as New submissions, Cross-lists, Replacements), **arXiv ID ↑ / ↓**, or **Primary category**. The **New submissions**, **Cross-lists** and **Replacements** boxes choose the sections shown and are saved with the subscription; a paper listed in several sections appears once.
- **Abstracts** are folded in the list by default: **Abstract ▸** on a row or `Space` unfolds one, the **Abstracts** box unfolds all. Formulas are rendered as set by **Abstract LaTeX** in Preferences.
- **Detail pane**: title, authors, arXiv ID, version, announcement date, categories, where the paper was announced (e.g. "hep-ph: new submission; hep-th: cross-list"), comments, journal reference, the paper's library state with its actions, **Copy BibTeX**, **PDF**, **HTML**, and the abstract. The divider between list and pane can be dragged (or moved with ← / → when focused); its position is remembered. For a paper with several versions, **version** is a chooser: picking an older version fetches it once from the arXiv API and shows its title, authors, abstract and submission date; **PDF** and **HTML** then refer to that version.
- **Filter box**: words or `"quoted phrases"` matched against authors, title, arXiv ID, categories, comments, journal reference (including shorthand such as `PRL`, `PRD`, `JHEP`) and abstract. Its history is shared with the References panel.
- **Quick filters (⏳)**: **Local items**, **Online items**, **≤10 Authors**, **Published** (has a journal reference), **arXiv only**.
- **In-library marks** (by arXiv ID, over all your libraries, trash excluded): ● in your library (click selects it in the main window), ②, ③ … several items, ⊕ not in your library (click adds it), ? the library could not be read (click tries again). The detail pane shows **✓ In your library** with **Show in library**.
- **PDF button**: green when the paper's item has a PDF, which a click opens in Zotero. A paper in your library without a PDF shows the blue download icon, as in the References panel: a click runs Zotero's **Find Full Text** on its item, and the button turns green when a PDF is found (in the detail pane the button reads **Find Full Text**; for an older version chosen there, **PDF** opens arXiv's PDF of that version). A paper not in your library: a click opens arXiv's PDF in your web browser.
- **Author card**: hover an author name. When INSPIRE has the paper, the INSPIRE author card appears; otherwise a local card. Both show the author's papers in your library and a link to the author's arXiv search.

### Searching arXiv

Type in the **Search arXiv** box and press Enter. Plain words search all fields and must all match; arXiv's own syntax works too, e.g. `au:witten`, `ti:tetraquark`, `abs:"chiral perturbation"`, `cat:hep-ph`, `AND`, `OR`, `ANDNOT`, parentheses, `submittedDate:[202601010000 TO 202612312359]`.

- Results are listed newest submission first, grouped by month, and fetched one page at a time. arXiv gives the first 10000 matches only.
- The filter box and quick filters apply to the results.
- The search box has its own history.
- **×**, or Enter in the empty box, returns to the listed days, at the same page and paper.

### Adding papers to your library

Add a paper with `a`, **Add…** in the detail pane, or a click on ⊕. The save-target picker (the same one as in the References panel) chooses the library or collection, tags and a note. The route is chosen from the data:

- **INSPIRE has the paper** (a record whose arXiv identifier is this paper): imported from INSPIRE, as from the References panel.
- **INSPIRE does not have it**: created from arXiv's data, as a Preprint (see **Keep Preprint item type for unpublished papers**) with the complete author list and `arXiv:<id> [category]` in Extra.
- **Add the journal version…** (shown when arXiv gives a journal reference): when INSPIRE has no record, the journal DOI is looked up with Zotero's own DOI lookup; if the result does not match the paper, the preprint is added instead and a notice says why.
- If INSPIRE cannot be reached, nothing is added until you choose **Add from arXiv data** or **Try later**.

A paper already in the target library (by arXiv ID, INSPIRE record or journal DOI) is not added again; **Show in library** selects it.

- **PDF**: when **Auto "Find Full Text" after adding to library** is on, the arXiv PDF of the paper's current version is attached ("arXiv preprint PDF vN"). **No arXiv PDF for journal articles added from the arXiv browser** leaves it out for journal items.
- **Tag**: with **arXiv Primary Category Tag** on, the primary category (e.g. `hep-ph`, `math.AG`) is added as a tag.
- **Several papers**: tick the boxes (`x`, Shift+click for a range). The toolbar in the first day header offers **Select all** (all pages), **Clear** and **Import**. Import uses the References panel's batch import: a duplicate check, one save target, each paper added once, `Escape` to cancel (which also stops its requests), and a summary of what was not added.
- **INSPIRE completion**: the status line reports "N preprints added recently have no INSPIRE record yet" for items added in the last 30 days with an arXiv ID and no INSPIRE record. **Check now** asks INSPIRE and lists the records found; for the items you tick, only the INSPIRE record ID, the citation key (where it is empty) and the citation counts are written; bibliographic fields are left unchanged.

### Relating papers to your items

`l`, **Relate to items…** or the row's link button opens Zotero's **Select Items** dialog on the paper's library; choose one or more items. A paper not yet in your library is added first. The relation is written in both directions in one step and can be undone with `Ctrl/Cmd+Z` in the window or `Edit` → `Undo`. Items in different libraries cannot be related. The link button is green when the paper's item has related items, which its tooltip lists; remove a relation in the item's **Related** section in Zotero.

### Copying and links

- **Copy BibTeX** (button, row button, right-click menu, `Ctrl/Cmd+Shift+C`): INSPIRE's BibTeX when INSPIRE has the paper, otherwise arXiv's. The citation key is the library item's key when the paper is in your library, otherwise INSPIRE's texkey, otherwise one made like INSPIRE's: first author's family name (or the collaboration), year of the arXiv ID and the first significant title word, e.g. `Finkelberg:2022kostka`. The notice says which source was used.
- **Right-click menu** in the list and the detail pane: **Copy** / **Copy Selection**, **Copy as LaTeX** (on an abstract with formulas in the detail pane), **Select All**, **Open Link in Web Browser**, **Copy Link Address**, and on a paper **Copy Title**, **Copy arXiv ID**, **Copy Link to the arXiv Page**, **Copy INSPIRE link**, **Copy BibTeX**.
- `Ctrl/Cmd+C` copies the selected text with each formula once; `Ctrl/Cmd+A` selects the text of the list or the detail pane.
- A click on a title, or `Enter`, opens the paper's arXiv page in your web browser.

### HTML version and snapshots

The **HTML** button in the detail pane and the `</>` button on each row (hidden when the listing says arXiv has no HTML version of the paper) open the saved snapshot in Zotero if there is one, and otherwise show arXiv's HTML version in the window, in the detail pane's place. Their ▾ menu offers **Show in This Window**, **Open in the Web Browser**, **Save HTML Snapshot to the Library** and **Open Snapshot in Zotero**.

In the window, the page has the detail pane's width (drag the divider or enlarge the window for more room). **‹ Details** above it, or focusing another paper in the list, returns to the details; **Open in the Web Browser** opens the same page there.

- Links within the page (sections, citations, footnotes) move within it; links to elsewhere (abstract page, PDF, DOIs) open in your web browser. The buttons of arXiv's page header work, including the table of contents and the reading mode.
- Resting the pointer on a link to an equation, a figure, a table or a reference shows it in a small box beside the link: the equation with its number, the figure or table with its caption, the reference with its links. The box stays while the pointer is in it (its links work) and closes when the pointer leaves it, on a click elsewhere, on scrolling the page and with `Escape` in the page.
- Selecting text that contains citations (such as "[12, 13]") shows below the selection, as the INSPIRE look-up in Zotero's PDF reader does, a small bar with their numbers. Resting the pointer on a number shows the INSPIRE card of that reference: authors, journal, citations, abstract, whether it is in your library, **Add to Library**, **Copy BibTeX** and more. A reference INSPIRE's list of the paper does not have, and every reference of a paper INSPIRE has no record of, shows arXiv's entry text instead. The paper's references are fetched from INSPIRE once, at the first such selection, and kept in the plugin's cache (the References panel's).
- `Ctrl/Cmd+F` finds in the page: `Ctrl/Cmd+G` and `Ctrl/Cmd+Shift+G` go to the next and previous match, `Escape` closes the find bar. The find bar is the Firefox platform's and is in English; `ss` and `ß` do not match each other.
- Keys pressed in the page belong to the page (`Space`, arrows, `Ctrl/Cmd+C`, `Ctrl/Cmd+A`). Right-click copies the selection and, on a link, opens it or copies its address.

Saving uses Zotero's own web snapshot of the listed version, titled "arXiv HTML vN", attached to the paper's item (the paper is added first if needed). The snapshot is a copy of arXiv's full-text HTML page, formulas and figures included; read and annotate it in Zotero's reader. Like other attachments it syncs, so it can also be read in Zotero's mobile apps.

In the INSPIRE References panel, **HTML** after a paper's arXiv number opens a menu: **Show in the arXiv Browser** opens the window (or brings it to the front) with arXiv's HTML version of the paper on its right-hand side, the list unchanged; **Save HTML Snapshot to the Library** saves the newest version to the paper's item (a paper not in your library is added first, where you choose); once a snapshot is saved, the button is green with a ✓ and the menu also offers **Open Snapshot in Zotero**.

### Requests to arXiv

Requests to arXiv are spaced as arXiv asks (15 s for its web pages, 3 s for its API); the status line counts down to the next one. Listings are cached for 100 days, so reopening the window costs no requests until the next announcement; **Reload** fetches the newest listing again. An HTML page shown in the window is loaded when you click, as a web browser would load it.

---

## INSPIRE Quick Start

### Update Metadata from INSPIRE

**Right-click any item** → `INSPIRE`:

- **`With abstracts`** — Full metadata including abstract
- **`Without abstracts`** — Skip abstract field
- **`Citation counts only`** — Just update citation numbers

The plugin automatically fetches metadata when you add new items (configurable in Preferences).

`Escape` or `INSPIRE` → **Cancel update** stops an update. Items INSPIRE gives no usable answer for are left unchanged.

### Copy Actions

**Right-click any item** → `INSPIRE` for quick copy options:

- **`Copy BibTeX`** — Fetch and copy BibTeX from INSPIRE
- **`Copy citation key`** — Copy the INSPIRE texkey
- **`Copy INSPIRE recid`** — Copy the INSPIRE record ID
- **`Copy INSPIRE link`** — Copy the INSPIRE literature URL
- **`Copy INSPIRE link (markdown)`** — Copy the INSPIRE literature URL in format of `[texkey](link)`
- **`Copy Zotero link`** — Copy Zotero select link
- **`Copy Funding Info`** — Extract and copy funding information from PDF acknowledgments

### Browse References Panel

Select an item with an INSPIRE record, then find the **INSPIRE** section in the right panel:

| Tab               | What it shows                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| **References**    | Papers cited by this item                                                                                |
| **Cited by**      | Papers that cite this item                                                                               |
| **Related**       | Recommended papers via a hybrid similarity score (shared references + co-citation)                       |
| **Entry Cited**   | Papers citing a specific reference, appears only after clicking the `Cited by ...` button below an entry |
| **Author Papers** | All papers by a clicked author, appears only after clicking an author name                               |
| **🔍**            | INSPIRE search results                                                                                   |
| **⭐ Favorites**  | Your favorite authors and papers                                                                         |

- **Related**: hybrid ranking = weighted bibliographic coupling (shared refs) + optional co-citation re-ranking; by default it ignores the PDG _Review of Particle Physics_ as a seed anchor (too generic).
- **Academic Tree**: explore advisor–student relationships in the shared **Connections Graph** window. See [Explore Academic Tree](#explore-academic-tree-new-in-320).
- **Citation Graph**: a 1-hop visualization (refs/cited-by configurable up to 200 per side). Open **Connections Graph** via the panel button or the main toolbar button next to the search box; with no selection it opens an empty canvas where you can add seeds. Drag the time-range sliders under each x-axis to zoom the time window. Use the Reviews toggle to include/exclude review articles (incl. PDG).

### Explore Academic Tree (new in 3.2.0)

Open **Academic Tree** from an author preview card or the **Author Papers** profile. You can also switch to **Academic Tree** at the top of the Connections Graph window and search for an author. The shared window can be resized or maximized.

- **Choose generations**: set ancestors from **0 to 10** and descendants from **0 to 8**, with **2 in each direction** by default. Zero hides that direction.
- **Sort within families**: students of the same advisor follow **Surname A–Z** (default) or **Education year ↑**; unknown years come last. Card tooltips show education end years.
- **Remember searches**: the ▾ button beside the author search box opens recent queries; Tab or → accepts an inline suggestion, ↓ opens the history.
- **Follow a name**: click an author's name to make them the tree's center and display their author page in the sidebar. Hover for the usual author preview, including favorites and paper actions.
- **Explore a branch**: click a card's background to select the person, then expand **one generation of advisors or students**; click a name at the edge to continue from a new center.
- **Revisit a tree**: Back and Forward restore earlier trees as you left them.
- **Co-advisors**: supplemental co-advisors (light gray cards) are hidden by default; **Show co-advisors** shows them.
- **Find / path**: find a person in the loaded tree by name, INSPIRE ID or affiliation; choose two people to highlight the shortest path between them.
- **Relationship qualifications**: labels under each name give the relationship to the visible advisors (PhD, Diploma, Bachelor, Master, Habilitation, Laurea, Other, Unspecified), not the person's highest degree; the relationship filter shows one type, **Specified qualifications**, or all.
- **Fit to page** (beside **Fit all**, **Center root**, **− / +**): wraps long generations into several rows at the window width; read left to right, then the next row. Toggle off to restore the tree layout.
- **Branches**: **Expand all shown ancestors’ students** adds one generation of students under every ancestor shown; the same button then collapses them again. You can also collapse or restore the selected person’s student branch.
- **📤 Export▼**: SVG, PNG, JSON or CSV, for **Current view** or **Full loaded tree** (SVG is best for large trees).

**Set as center** makes the selected person the center. **Refresh from INSPIRE** fetches the current tree again; **Retry** appears after failures and **Continue loading** after **Stop**.

Relationships come from **public INSPIRE author records**; arrows point from advisor to student. Dashed cards have no linked author record and cannot be expanded. A missing record does not mean there is no relationship.

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
- **Keep Preprint item type for unpublished papers** (on by default) — Preprint items stay Preprint until INSPIRE reports a journal publication; untick it to convert everything to Journal Article.

---

## Panel Features

### Status Indicators

| Icon       | Meaning                       |
| ---------- | ----------------------------- |
| ● (green)  | Item exists in your library   |
| ②, ③ …     | Several items for this paper  |
| ⊕ (red)    | Item can be imported          |
| ?          | Library could not be read     |
| 🔗 (green) | Linked as related item        |
| 🔗 (gray)  | Not linked                    |
| 📄 (green) | PDF available - click to open |
| ⬇️ (blue)  | Find Full Text available      |
| 📄 (gray)  | No PDF / Not in library       |

### Interactions

| Action               | Result                                                      |
| -------------------- | ----------------------------------------------------------- |
| Click ●              | Jump to local item                                          |
| Double-click ●       | Open PDF directly                                           |
| Click ⊕              | Open import dialog                                          |
| Click 🔗             | Toggle related item link (Edit → Undo takes it back)        |
| Click 📄 (green)     | Open PDF attachment                                         |
| Click ⬇️ (blue)      | Trigger Find Full Text                                      |
| Click HTML           | Menu of arXiv's [HTML version](#html-version-and-snapshots) |
| Click title          | Open in INSPIRE                                             |
| Hover title          | Show abstract                                               |
| Click author         | View author's papers                                        |
| Hover author         | Show author profile                                         |
| Click citation count | View citing papers                                          |
| Click 📋             | Copy BibTeX                                                 |
| Click T              | Copy citation key                                           |
| Right-click entry    | Context menu (Favorites)                                    |

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
3. The plugin detects duplicates automatically before importing; the dialog says how many items match a paper and, when group libraries are involved, in which libraries
4. A paper shown in several rows is imported once; press `Escape` to cancel, which also stops the requests in progress

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
   - In the preview card: click **In Library** to select the item in Zotero; click **Online** to open the record in your browser (prefers INSPIRE)
3. **Click** to jump to and highlight the corresponding reference in the panel

**Supported formats**: `[1]`, `[1,2,3]`, `[1-5]`, `[Smith 2024]`, `[arXiv:2301.12345]`, superscripts

---

## Keyboard Shortcuts

### References panel

| Key                | Action             |
| ------------------ | ------------------ |
| `↑` / `k`          | Previous entry     |
| `↓` / `j`          | Next entry         |
| `←` / `→`          | Navigate history   |
| `Home` / `End`     | Jump to first/last |
| `Enter`            | Open PDF or import |
| `Space` / `l`      | Toggle link        |
| `Tab`              | Next tab           |
| `Ctrl/Cmd+Shift+C` | Copy BibTeX        |
| `Escape`           | Clear selection    |

### arXiv browser window

Keys act on the focused paper and are ignored while you type in a text box.

| Key                              | Action                                                   |
| -------------------------------- | -------------------------------------------------------- |
| `j` / `↓`, `k` / `↑`             | Next / previous paper (continues onto the next page)     |
| `n` / `p`                        | Next / previous page                                     |
| `Home` / `End`                   | First / last paper of the page                           |
| `Space`                          | Fold or unfold the abstract                              |
| `Enter`                          | Open the paper's arXiv page in the web browser           |
| `a`                              | Add to the library (save-target picker)                  |
| `l`                              | Relate to items (Select Items dialog)                    |
| `x`                              | Tick or untick for batch import                          |
| `Escape`                         | Clear the focus; close the calendar or the find bar      |
| `Ctrl/Cmd+F`                     | Find in the HTML page shown in the window                |
| `Ctrl/Cmd+G`, `Ctrl/Cmd+Shift+G` | Next / previous match in the HTML page                   |
| `Ctrl/Cmd+Shift+C`               | Copy BibTeX                                              |
| `Ctrl/Cmd+C`                     | Copy the selected text (each formula once)               |
| `Ctrl/Cmd+A`                     | Select the text of the list or the detail pane           |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | Undo / redo (relations made in the window, among others) |
| `Ctrl/Cmd+W`                     | Close the window                                         |
| `←` / `→` on the divider         | Move the divider                                         |

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

Enable **Preprint Watch** in Preferences to automatically check if your arXiv preprints have been published. Both Journal Article items carrying arXiv data and Zotero `Preprint` items are monitored (see **Keep Preprint item type** above).

- Check by hand with right-click → `INSPIRE` → **Check Preprint Status** (items), **Check Preprints in Collection**, or **Check All Preprints in Library** (My Library and every editable group library).
- A record whose title or first author differs from the item's is shown with a warning and left unticked.
- Besides published papers to update, the results list preprints INSPIRE has a record of while their items lack it; for these only the INSPIRE record ID, citation key and citation counts are written.

### Smart Update Mode

Enable **Smart Update** in Preferences to preserve your manual edits when updating metadata. You can protect specific fields (title, authors, abstract, journal) and author names with diacritics.

Authors are never dropped silently: if INSPIRE's list lacks authors the item has, the item keeps its list.

### Better BibTeX Integration

The plugin automatically sets INSPIRE citation keys in Zotero's Citation Key field, which Better BibTeX can use for pinning.

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

| Setting                               | Description                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-fetch for new items**          | Fetch metadata automatically when adding items                                                                                                 |
| **Use INSPIRE Citekey**               | Write INSPIRE texkey to the Citation Key field                                                                                                 |
| **Max authors**                       | Number of authors shown before "et al."                                                                                                        |
| **Statistics chart**                  | Show year/citation distribution chart                                                                                                          |
| **Local cache**                       | Enable persistent disk cache for offline use                                                                                                   |
| **Smart Update**                      | Preserve manual edits during updates                                                                                                           |
| **Preprint Watch**                    | Monitor unpublished preprints                                                                                                                  |
| **Keep Preprint item type**           | On by default: Preprint items stay until INSPIRE reports a journal publication |
| **Fuzzy citation detection**          | For PDFs with broken text layers                                                                                                               |
| **Reuse Zotero 10 citation analysis** | Background reuse of completed Zotero 10.0 results; restart required                                                                            |
| **Abstract LaTeX mode**               | KaTeX (full rendering, default) or Unicode                                                                                                     |

**arXiv Browser** section and related options:

| Setting                                                            | Description                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Opens with the subscription**                                    | The subscription the window shows first (default: the first one)                                    |
| **Opens with**                                                     | The newest day (default), the last 5 announcement days, or this week                                |
| **Show the abstracts in the list**                                 | Off by default: abstracts are folded in the list; the chosen paper's abstract is in the detail pane |
| **Papers per page**                                                | 10 to 500 (default 50); also set from the list                                                      |
| **Open the arXiv browser when Zotero starts**                      | Off by default                                                                                      |
| **Auto "Find Full Text" after adding to library**                  | In the arXiv browser: attach the arXiv PDF to papers added                                          |
| **No arXiv PDF for journal articles added from the arXiv browser** | With the option above on, journal items added from INSPIRE or by DOI get no arXiv PDF               |

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

## External APIs (for local tools)

### Read-only INSPIRE BibTeX

zotero-inspire registers an authenticated
`POST /connector/zinspireBibtex` endpoint for trusted local clients such as
[`fkguo/zotero-cite`](https://github.com/fkguo/zotero-cite), a fork of the
`zotero-cite` VS Code extension with INSPIRE-HEP support. Use that fork: the
upstream `zotero-cite` has no zotero-inspire settings and does not call this
endpoint. Given Better BibTeX/CAYW citation keys, the endpoint finds the
matching items across personal and group libraries, fetches their BibTeX from
INSPIRE using the record ID stored by zotero-inspire, and rewrites each entry
key to the requested citation key. Items without an INSPIRE record fall back to
a Better BibTeX export. The endpoint is read-only and uses its own token,
separate from the write API. Full versioned contract:
[`docs/EXTERNAL_INSPIRE_BIBTEX_API.md`](docs/EXTERNAL_INSPIRE_BIBTEX_API.md).

### Zotero writes

Since **3.0.3**, zotero-inspire registers an authenticated
`POST /connector/zinspireWrite` endpoint so trusted local tools can do what
Zotero's read-only Local API cannot: attach a local file to an item, and
trash/erase items. This is what the
**[nullius](https://github.com/fkguo/nullius) `zotero-mcp` / `hep-mcp`**
integration uses for PDF attachment and deletion. Full contract (auth,
operations, errors, dependency notes):
[`docs/EXTERNAL_WRITE_API.md`](docs/EXTERNAL_WRITE_API.md).

---

## License

Mozilla Public License (MPL) Version 2.0

---

## Acknowledgments

Built with [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template). Inspired by [zotero-shortdoi](https://github.com/bwiernik/zotero-shortdoi) and [zotero-citationcounts](https://github.com/eschnett/zotero-citationcounts).
