# arXiv pages for the listing tests

Pages saved from arxiv.org and export.arxiv.org. Unless marked otherwise, a file
is the response body exactly as received.

Saved on 26 September 2026 (UTC), while the arXiv browser was designed:

| File                                           | Request                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-hep-ph-new-2026-09-25.html`              | `https://arxiv.org/list/hep-ph/new` (up to 2000 per page: the whole day)                                                                            |
| `list-astro-ph.CO-new-show25-2026-09-25.html`  | `https://arxiv.org/list/astro-ph.CO/new?skip=0&show=25`                                                                                             |
| `list-quant-ph-new-show25-2026-09-25.html`     | `https://arxiv.org/list/quant-ph/new?skip=0&show=25`                                                                                                |
| `list-cs.GL-new-empty-2026-09-25.html`         | `https://arxiv.org/list/cs.GL/new` (a day without papers in cs.GL)                                                                                  |
| `list-math-recent-show25-2026-09-25.html`      | `https://arxiv.org/list/math/recent?show=25`                                                                                                        |
| `catchup-hep-ph-2026-09-21.html`               | `https://arxiv.org/catchup/hep-ph/2026-09-21?abs=True`                                                                                              |
| `catchup-cs.GL-2026-09-24-empty.html`          | `https://arxiv.org/catchup/cs.GL/2026-09-24?abs=True` (past day, no papers)                                                                         |
| `catchup-cs.GL-2026-09-25-empty-latest.html`   | `https://arxiv.org/catchup/cs.GL/2026-09-25?abs=True` (latest day, no papers, no next-day link)                                                     |
| `catchup-hep-ph-2026-09-19-weekend-noabs.html` | `https://arxiv.org/catchup/hep-ph/2026-09-19` (Saturday)                                                                                            |
| `catchup-hep-ph-2026-09-08-holiday-noabs.html` | `https://arxiv.org/catchup/hep-ph/2026-09-08` (no announcement after Labor Day)                                                                     |
| `catchup-hep-ph-2026-06-01-status400.html`     | `https://arxiv.org/catchup/hep-ph/2026-06-01` (HTTP 400, older than 90 days)                                                                        |
| `list-math-new-2026-09-25-trimmed.html`        | `https://arxiv.org/list/math/new` (up to 2000 per page), **trimmed** (below)                                                                        |
| `api-idlist-5.xml`                             | `https://export.arxiv.org/api/query?id_list=1706.03762,1801.00862,2103.00001,2609.28534,2502.20357` (the feed records the default `max_results=10`) |
| `api-idlist-14-default-max10.xml`              | `https://export.arxiv.org/api/query?id_list=<14 identifiers>` without `max_results`: 10 returned                                                    |

Saved on 27 September 2026, 16:55–16:57 UTC, five anonymous requests 20 s
apart (arxiv.org's `robots.txt` asks for 15 s); the listing of 25 September was
still the newest:

| File                                                         | Request                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `list-cs.LG-new-show100-skip{0,100,200,300}-2026-09-25.html` | `https://arxiv.org/list/cs.LG/new?skip=<n>&show=100`, **abstracts shortened** (below) |
| `catchup-cs-2026-09-22-page2-trimmed.html`                   | `https://arxiv.org/catchup/cs/2026-09-22?abs=True&page=2`, **trimmed** (below)        |

Changes made to keep the files small:

- `list-math-new-2026-09-25-trimmed.html` (1.8 MB as received): kept the first 8
  entries of each section, plus the entries whose primary category is `cs.IT`
  (alias `math.IT`) or `math-ph` (alias `math.MP`), two of each per section,
  plus `2609.28500` and `math/0702261`; every section heading and both
  "Total of N entries" lines were changed to the counts that remain (12, 8, 13;
  33). Item numbers and the section index at the top were left as received.
- `list-cs.LG-new-show100-skip*-2026-09-25.html`: each abstract was replaced by
  its first 150 characters of text (markup removed) and "…". Nothing else was
  changed; the four pages are the whole day (331 entries).
- `catchup-cs-2026-09-22-page2-trimmed.html` (274 entries as received): kept the
  first 3 entries; the section heading "showing last 274 of 735 entries" became
  "showing last 3 of 735 entries". The day's total (2274) and the paging links
  were left as received.

Saved on 29 September 2026, 13:29–13:35 UTC, for the search of arXiv in the
browser window (anonymous requests at least 3 s apart), as received:

| File                                 | Request                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-search-hep-ph-tetraquark-3.xml` | `https://export.arxiv.org/api/query?search_query=cat%3Ahep-ph+AND+ti%3Atetraquark&sortBy=submittedDate&sortOrder=descending&start=0&max_results=3`    |
| `api-search-error-400.xml`           | `https://export.arxiv.org/api/query?search_query=ti%3A%28&sortBy=submittedDate&sortOrder=descending&start=0&max_results=2` (HTTP 400, an error entry) |
