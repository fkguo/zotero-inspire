# Zotero INSPIRE Metadata Updater

This is an add-on for the excellent open-source reference manager [Zotero](https://github.com/zotero/zotero). It is useful as most papers from [arXiv](https://arxiv.org) will get published in journals later on. This add-on can be used to update the metadata of the selected item(s) in your Zotero library from the [INSPIRE](https://inspirehep.net) database. 



## Usage

- Right click a selected item or multiple selected items, click `Update INSPIRE Metadata`, then choose one of the two options: fetch the metadata with or without abstracts.

- Right click a selected collection, then click `Update INSPIRE Metadata` `w/ Abstracts` or `w/o Abstracts`.

- Automatically retrieve the metadata from INSPIRE when adding a new item to the Zotero library. Options with or without getting abstracts can be set through the `Tools` menu → `INSPIRE Metadata`…

- The add-on will update the following fields:
	- INSPIRE uses a unique `recid` for each publication in the database (called `control_number` in the `.json` file obtained via the [INSPIRE API](https://github.com/inspirehep/rest-api-doc)). The INSPIRE `recid` is set to the field of `Loc. in Archive` (and `INSPIRE` to `Archive`) for the selected Zotero item.
		- This also enables us to write a look-up engine using this `recid` to exactly reach the INSPIRE page of that publication. The look-up engine can be added by editing the `engines.json` file in the `locate` folder of the Zotero Data Directory. The directory can be found by clicking `Zotero Preferences` → `Advanced` → `Files and Folders` → `Show Data Directory`. Add the following code to the `engines.file`, and put the path to the INSPIRE icon file after `"_icon":`:
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
		
	- `journal` (set to `Journal Abbr` in Zotero), `volume`, `year`, `pages` (either the page numbers or the modern article IDs), `issue`, and `abstract`.

## Prerequisite

The add-on fetch search for the INSPIRE record according to DOI or arXiv numbers. For it to work as expected,
- the DOI should be either in the `DOI` fiel, or in the `extra` field in the format of `DOI: `.
- as for arXiv papers, there should be either a url in the `URL` field, or an arXiv ID in the `extra` field in the format of  `arXiv:`.

There are old papers in the INSPIRE database without a DOI number. However, the INSPIRE API currently does not support using the citekey to access the relevant publication.

## Installation

- Download the `.xpi` file of this add-on from https://github.com/fkguo/zotero-inspire/releases
- In Zotero, the add-on can be installed by going to `Tools` → `Add-ons`, then click the top-right button and choose `Install Add-ons From File...`.

## References

I know basically nothing about javascript. This add-on was developed by modifying the codes of the following two add-ons:

- https://github.com/bwiernik/zotero-shortdoi

- https://github.com/eschnett/zotero-citationcounts

## License

Distributed under the Mozilla Public License (MPL) Version 2.0.
