# Zotero INSPIRE Metadata Updater

This is an add-on for the excellent open-source reference manager [Zotero](https://github.com/zotero/zotero). It is useful as most papers from [arXiv](https://arxiv.org) will get published in journals later on. This add-on can be used to update the metadata of the selected item(s) in your Zotero library from the [INSPIRE](https://inspirehep.net) database. 


## Installation

- Download the latest `.xpi` file of this add-on from https://github.com/fkguo/zotero-inspire/releases
- In Zotero, the add-on can be installed by going to `Tools` → `Add-ons`, then click the top-right button and choose `Install Add-ons From File...`.
- It can be updated in `Add-ons Manager` → `Check for Updates`.


## Usage

- Right click a selected item or multiple selected items, click `Update INSPIRE Metadata`, then choose one of the three options: fetch the metadata with or without abstracts, or update only the citations with and w/o self citations.

- Right click a selected collection, then click one of the three options.

- Automatically retrieve the metadata from INSPIRE when adding a new item to the Zotero library. Options with or without getting abstracts can be set through the `Tools` menu → `INSPIRE Metadata`…

- Metadata can be fetched as long as one of the following is provided:
	- DOI in the field of `DOI` or `Extra`; if it is only in `Extra`, then it should contain `DOI:` or `doi.org/` followed by the DOI.
	- arXiv link in `URL` or arXiv ID in `Extra` in the form of `arXiv:`.
	- INSPIRE Citation key in `Extra` in the form of `Citation Key: `.
	- INSPIRE `recid` in `Loc. in Archive` or the url containing `/literature/recid` in `URL`.

- The add-on will update the following fields:
	- INSPIRE uses a unique `recid` for each publication in the database (called `control_number` in the `.json` file obtained via the [INSPIRE API](https://github.com/inspirehep/rest-api-doc)). The INSPIRE `recid` is set to the field of `Loc. in Archive` (and `INSPIRE` to `Archive`) for the selected Zotero item.
		- This also enables to write a look-up engine using this `recid` to exactly reach the INSPIRE page of that publication. The look-up engine can be added by editing the `engines.json` file in the `locate` folder of the Zotero Data Directory. The directory can be found by clicking `Zotero Preferences` → `Advanced` → `Files and Folders` → `Show Data Directory`. Add the following code to the `engines.json` file, and put the path to the INSPIRE icon file after `"_icon":`:
		```json
		{
			"_name": "INSPIRE",
			"_alias": "INSPIRE",
			"_description": "INSPIRE",
			"_icon": ,  // path to the INSPIRE icon,
			"_hidden": false,
			"_urlTemplate": "https://inspirehep.net/literature/{z:archiveLocation}",
			"_urlNamespaces": {
				"z": "http://www.zotero.org/namespaces/openSearch#"
			}
		}
		```
		
	- `journal` (set to `Journal Abbr` in Zotero), `volume`, `year`, `pages` (either the page numbers or the modern article IDs), `issue`, `DOI`, `authors` ($\leq10$, otherwise keeping only the first 3; the author list will be updated if no author is given or the first name of the first author is empty), `title`, `abstract`, etc. 
	- Set the arXiv number of articles that are not published to the `Journal Abbr` field. Items of type `report` or `preprint` are set to `journalArticle`.
	- It will also get the citation counts with and without self-citations for each selected item. One can also choose to update only the citation counts using `Citation counts only` in the right-click menu. 
		- The current INSPIRE system does not display the citation count without self citations for a given paper. However, this number is in the metadata, and can be extracted with this add-on.
		- Citation counts are changed only when they are different from those of the last fetching.
	- The [Better BibTeX (BBT)](https://retorque.re/zotero-better-bibtex) plugin can pin the citation key from INSPIRE. When we add new arXiv articles, sometimes BBT fails to get the INSPIRE record. In that case, this plugin writes the INSPIRE citation key to the `Extra` field so that it is pinned correctly (the BBT plugin needs to be installed).
	- Work with the [INSPIRE Zotero translator](https://github.com/zotero/translators/blob/master/INSPIRE.js), and change `"_eprint"` in `Extra` to `arXiv`.
- By default, those items that could not be found will be tagged as `⛔ No INSPIRE recid found`, which will be removed once it is in INSPIRE. The automatic tagging can be turned off in `Tools` → `INSPIRE Metadata Updater Preferences...`.



## References

I knew basically nothing about javascript. The first version of this add-on was developed by modifying the codes of the following two add-ons:

- https://github.com/bwiernik/zotero-shortdoi

- https://github.com/eschnett/zotero-citationcounts

## License

Distributed under the Mozilla Public License (MPL) Version 2.0.
