/* Zotero plugin for updating publication meta from the INSPIRE database

FK Guo  | 2022-05-24

The zotero part was written according to the following plugins:
https://github.com/eschnett/zotero-citationcounts
https://github.com/bwiernik/zotero-shortdoi
*/

if (typeof Zotero === 'undefined') {
    Zotero = {};
}
Zotero.Inspire = {};


/* Definitions of functions fetching and setting metadata using the INSPIRE api

 getInspireMeta(item): get the INSPIRE recid and check for publication metadata for arxiv papers
 setInspireMeta(item, metaInspire, operation): set the Zotero item fields

 possible operations:
 - full: fetching medatadata including abstract
 - noabstract: no abstract
 - citations: update citation counts for INSPIRE
 - none: nothing
 */
async function getInspireMeta(item) {

    let meta = null;
    let metaInspire = {};

    let doi = item.getField('DOI');
    const url = item.getField('url');

    let idtype = 'doi';
    if (!doi) {
        let extra = item.getField('extra');

        if (extra.includes('arXiv:')) {
            idtype = 'arxiv';
            const regexArxivId = 'arXiv:(.+)'
            /* in this way, different situations are included:
            New and old types of arXiv number; 
            whether or not the arXiv line is at the end of extra
            */
            let arxiv_split = extra.match(regexArxivId)[1].split(' ')
            arxiv_split[0] == '' ? doi = arxiv_split[1] : doi = arxiv_split[0]
        } else if (url) {
            const patt = /(?:arxiv.org[/]abs[/]|arXiv:)([a-z.-]+[/]\d+|\d+[.]\d+)/i;
            const m = patt.exec(url);
            if (!m) {
                if (url.includes('doi')) {
                    doi = url.replace('https://doi.org/', '')
                } else {
                    return "No valid arxiv ID found in url"
                }
            } else {
                idtype = 'arxiv';
                doi = m[1]
            }
        } else {
            const regexDOIinExtra = 'DOI: (.+)'
            extra.includes('DOI: ') && (doi = extra.match(regexDOIinExtra)[1])
        }
    } else {
        doi.includes("https") && (doi = doi.replace('https://doi.org/', ''))
    }
    // if (!doi) {
    //     return -1;
    // }

    const edoi = encodeURIComponent(doi);

    const urlInspire = "https://inspirehep.net/api/" + idtype + "/" + edoi;
    let status = null;
    const response = await fetch(urlInspire)
        //   .then(response => response.json())
        .then(response => {
            if (response.status !== "404") {
                status = 1;
                return response.json()
            }
        })
        .catch(err => null);

    if (status == null) {
        return -1;
    }

    try {
        meta = response['metadata'];
        metaInspire.recid = meta['control_number']
        // get only the first doi
        if (meta['dois'] !== undefined) {
            metaInspire.DOI = meta['dois'][0].value
        }
        const publication_info = meta['publication_info']
        if (publication_info) {
            pubinfo_first = publication_info[0]
            if (pubinfo_first.journal_title) {
                let jAbbrev = ""
                jAbbrev = pubinfo_first.journal_title;
                metaInspire.journalAbbreviation = jAbbrev.replace(".", ". ");
                metaInspire.volume = pubinfo_first.journal_volume;
                if (pubinfo_first.artid) {
                    metaInspire.pages = pubinfo_first.artid;
                } else {
                    metaInspire.pages = pubinfo_first.page_start
                    pubinfo_first.page_end && (metaInspire.pages = metaInspire.pages + "-" + pubinfo_first.page_end)
                }
                metaInspire.date = pubinfo_first.year;
                metaInspire.issue = pubinfo_first.journal_issue
            }
        }
        if (meta['abstracts']) {
            let abstractInspire = meta['abstracts']
            if (abstractInspire.length > 1) {
                for (i = 0; i < abstractInspire.length; i++) {
                    abstractInspire[i].source == "arXiv" && (metaInspire.abstractNote = abstractInspire[i].value)
                }
            } else {
                metaInspire.abstractNote = abstractInspire[0].value
            }
        }
        metaInspire.citation_count = meta['citation_count']
        metaInspire.citation_count_wo_self_citations = meta['citation_count_without_self_citations']
    } catch (err) {
        return -1;
    }

    return metaInspire;
}

/*
  set the metadata to Zotero items.
  The zotero item fields are listed at 
  https://www.zotero.org/support/dev/client_coding/javascript_api/search_fields
*/
function setInspireMeta(item, metaInspire, operation) {

    const today = new Date(Date.now()).toLocaleDateString('zh-CN');

    if (item.getField('publicationTitle').includes('arXiv')) {
        item.setField('publicationTitle', "")
    }
    if (item.getField('proceedingsTitle').includes('arXiv')) {
        item.setField('proceedingsTitle', "")
    }
    // item.setField('archiveLocation', metaInspire);
    if (metaInspire.recid !== -1 && metaInspire.recid !== undefined) {
        if (operation == 'full' || operation == 'noabstract') {
            item.setField('archive', "INSPIRE");
            item.setField('archiveLocation', metaInspire.recid);

            metaInspire.journalAbbreviation && item.setField('journalAbbreviation', metaInspire.journalAbbreviation);
            // to avoid setting undefined to zotero items
            metaInspire.volume && item.setField('volume', metaInspire.volume);
            metaInspire.pages && item.setField('pages', metaInspire.pages);
            metaInspire.date && item.setField('date', metaInspire.date);
            metaInspire.issue && item.setField('issue', metaInspire.issue);
            metaInspire.DOI && item.setField('DOI', metaInspire.DOI);

            let extra = item.getField('extra')
            // remove old citation counts 
            extra = extra.replace(/^.*citations.*$\n/mg, "");
            extra = `${metaInspire.citation_count} citations (INSPIRE ${today})\n` + `${metaInspire.citation_count_wo_self_citations} citations w/o self (INSPIRE ${today})\n` + extra
            item.setField('extra', extra)
        };

        if (operation == "full" && metaInspire.abstractNote) {
            item.setField('abstractNote', metaInspire.abstractNote)
        };

        if (operation == "citations") {
            let extra = item.getField('extra')
            // remove old citation counts
            extra = extra.replace(/^.*citations.*$\n/mg, "");
            extra = `${metaInspire.citation_count} citations (INSPIRE ${today})\n` + `${metaInspire.citation_count_wo_self_citations} citations w/o self (INSPIRE ${today})\n` + extra
            item.setField('extra', extra)
        }
    }
}

// Preference managers

Zotero.Inspire.getPref = function (pref) {
    return Zotero.Prefs.get('extensions.inspire.' + pref, true)
};

Zotero.Inspire.setPref = function (pref, value) {
    return Zotero.Prefs.set('extensions.inspire.' + pref, value, true)
};

// Startup - initialize plugin

Zotero.Inspire.init = function () {
    Zotero.Inspire.resetState("initial");

    // Register the callback in Zotero as an item observer
    const notifierID = Zotero.Notifier.registerObserver(
        Zotero.Inspire.notifierCallback, ['item']);

    // Unregister callback when the window closes (important to avoid a memory leak)
    window.addEventListener('unload', function (e) {
        Zotero.Notifier.unregisterObserver(notifierID);
    }, false);
};

Zotero.Inspire.notifierCallback = {
    notify: function (event, type, ids, extraData) {
        if (event == 'add') {
            switch (Zotero.Inspire.getPref("autoretrieve")) {
                case "full":
                    Zotero.Inspire.updateItems(Zotero.Items.get(ids), "full");
                    break;
                case "noabstract":
                    Zotero.Inspire.updateItems(Zotero.Items.get(ids), "noabstract");
                    break;
                case "citations":
                    Zotero.Inspire.updateItems(Zotero.Items.get(ids), "citations");
                    break;
                default:
                    break;
            }
        }
    }
};

// Controls for Tools menu

// *********** Set the checkbox checks, from pref
Zotero.Inspire.setCheck = function () {
    let tools_full = document.getElementById(
        "menu_Tools-inspire-menu-popup-full");
    let tools_noabstract = document.getElementById(
        "menu_Tools-inspire-menu-popup-noabstract");
    let tools_citations = document.getElementById(
        "menu_Tools-inspire-menu-popup-citations");
    let tools_none = document.getElementById(
        "menu_Tools-inspire-menu-popup-none");
    const pref = Zotero.Inspire.getPref("autoretrieve");
    tools_full.setAttribute("checked", Boolean(pref === "full"));
    tools_noabstract.setAttribute("checked", Boolean(pref === "noabstract"));
    tools_citations.setAttribute("checked", Boolean(pref === "citations"));
    tools_none.setAttribute("checked", Boolean(pref === "none"));
};

// *********** Change the checkbox, topref
Zotero.Inspire.changePref = function changePref(option) {
    Zotero.Inspire.setPref("autoretrieve", option);
};

/**
 * Open the preference window
 */
Zotero.Inspire.openPreferenceWindow = function (paneID, action) {
    const io = {
        pane: paneID,
        action: action
    };
    window.openDialog(
        'chrome://zoteroinspire/content/options.xul',
        'inspire-pref',
        'chrome,titlebar,toolbar,centerscreen' + Zotero.Prefs.get('browser.preferences.instantApply', true) ? 'dialog=no' : 'modal',
        io
    );
};


Zotero.Inspire.resetState = function (operation) {
    if (operation == "initial") {
        if (Zotero.Inspire.progressWindow) {
            Zotero.Inspire.progressWindow.close();
        }
        Zotero.Inspire.current = -1;
        Zotero.Inspire.toUpdate = 0;
        Zotero.Inspire.itemsToUpdate = null;
        Zotero.Inspire.numberOfUpdatedItems = 0;
        Zotero.Inspire.counter = 0;
        error_norecid = null;
        error_norecid_shown = false;
        final_count_shown = false;
        return;
    } else {
        if (error_norecid) {
            Zotero.Inspire.progressWindow.close();
            const icon = "chrome://zotero/skin/cross.png";
            if (error_norecid && !error_norecid_shown) {
                let progressWindowNoRecid = new Zotero.ProgressWindow({
                    closeOnClick: true
                });
                progressWindowNoRecid.changeHeadline("INSPIRE recid not found");
                if (Zotero.Inspire.getPref("tag_norecid") !== "") {
                    progressWindowNoRecid.progress = new progressWindowNoRecid.ItemProgress(icon, "No INSPIRE recid was found for some items. These have been tagged with '" + Zotero.Inspire.getPref("tag_norecid") + "'.");
                } else {
                    progressWindowNoRecid.progress = new progressWindowNoRecid.ItemProgress(icon, "No INSPIRE recid was found for some items.");
                }
                progressWindowNoRecid.progress.setError();
                progressWindowNoRecid.show();
                progressWindowNoRecid.startCloseTimer(8000);
                error_norecid_shown = true;
            }
        } else {
            if (!final_count_shown) {
                const icon = "chrome://zotero/skin/tick.png";
                Zotero.Inspire.progressWindow = new Zotero.ProgressWindow({
                    closeOnClick: true
                });
                Zotero.Inspire.progressWindow.changeHeadline("Finished");
                Zotero.Inspire.progressWindow.progress = new Zotero.Inspire.progressWindow.ItemProgress(icon);
                Zotero.Inspire.progressWindow.progress.setProgress(100);
                if (operation == "full" || operation == "noabstract") {
                    Zotero.Inspire.progressWindow.progress.setText(
                        "INSPIRE metadata updated for " +
                        Zotero.Inspire.counter + " items.");
                }
                if (operation == "citations") {
                    Zotero.Inspire.progressWindow.progress.setText(
                        "INSPIRE citation counts updated for " +
                        Zotero.Inspire.counter + " items.");
                }
                Zotero.Inspire.progressWindow.show();
                Zotero.Inspire.progressWindow.startCloseTimer(4000);
                final_count_shown = true;
            }
        }
        return;
    }
};

Zotero.Inspire.updateSelectedCollection = (operation) => {
    const collection = ZoteroPane.getSelectedCollection();
    if (collection) {
        const items = collection.getChildItems(false, false);
        Zotero.Inspire.updateItems(items, operation);
    }
};

Zotero.Inspire.updateSelectedItems = function (operation) {
    Zotero.Inspire.updateItems(ZoteroPane.getSelectedItems(), operation);
};

Zotero.Inspire.updateItems = function (items0, operation) {
    const items = items0.filter(item => !item.isFeedItem);

    if (items.length === 0 ||
        Zotero.Inspire.numberOfUpdatedItems <
        Zotero.Inspire.toUpdate) {
        return;
    }

    Zotero.Inspire.resetState("initial");
    Zotero.Inspire.toUpdate = items.length;
    Zotero.Inspire.itemsToUpdate = items;

    // Progress Windows
    Zotero.Inspire.progressWindow =
        new Zotero.ProgressWindow({
            closeOnClick: false
        });
    const icon = 'chrome://zotero/skin/toolbar-advanced-search' +
        (Zotero.hiDPI ? "@2x" : "") + '.png';
    if (operation == "full" || operation == "noabstract") {
        Zotero.Inspire.progressWindow.changeHeadline(
            "Getting INSPIRE metadata", icon);
    }
    if (operation == "citations") {
        Zotero.Inspire.progressWindow.changeHeadline(
            "Getting INSPIRE citation counts", icon);
    }
    const inspireIcon =
        'chrome://zoteroinspire/skin/inspire' +
        (Zotero.hiDPI ? "@2x" : "") + '.png';
    Zotero.Inspire.progressWindow.progress =
        new Zotero.Inspire.progressWindow.ItemProgress(
            inspireIcon, "Retrieving INSPIRE metadata.");
    Zotero.Inspire.updateNextItem(operation);
};

Zotero.Inspire.updateNextItem = function (operation) {
    Zotero.Inspire.numberOfUpdatedItems++;

    if (Zotero.Inspire.current == Zotero.Inspire.toUpdate - 1) {
        Zotero.Inspire.progressWindow.close();
        Zotero.Inspire.resetState(operation);
        return;
    }

    Zotero.Inspire.current++;

    // Progress Windows
    const percent = Math.round((Zotero.Inspire.numberOfUpdatedItems / Zotero.Inspire.toUpdate) * 100);
    Zotero.Inspire.progressWindow.progress.setProgress(percent);
    Zotero.Inspire.progressWindow.progress.setText(
        "Item " + Zotero.Inspire.current + " of " +
        Zotero.Inspire.toUpdate);
    Zotero.Inspire.progressWindow.show();

    Zotero.Inspire.updateItem(
        Zotero.Inspire.itemsToUpdate[Zotero.Inspire.current],
        operation);
};

Zotero.Inspire.updateItem = async function (item, operation) {
    if (operation == "full" || operation == "noabstract" || operation == "citations") {

        const metaInspire = await getInspireMeta(item);
        // if (metaInspire !== {}) {
        if (metaInspire.recid !== -1 && metaInspire.recid !== undefined) {
            if (item.hasTag(Zotero.Inspire.getPref("tag_norecid"))) {
                item.removeTag(Zotero.Inspire.getPref("tag_norecid"));
                item.saveTx();
            }
            setInspireMeta(item, metaInspire, operation);
            item.saveTx();
            Zotero.Inspire.counter++;
        } else {
            if (Zotero.Inspire.getPref("tag_norecid") !== "" && !item.hasTag(Zotero.Inspire.getPref("tag_norecid"))) {
                item.addTag(Zotero.Inspire.getPref("tag_norecid"), 1);
                item.saveTx();
            }
        }
        Zotero.Inspire.updateNextItem(operation);

    } else {
        Zotero.Inspire.updateNextItem(operation);
    }
};

if (typeof window !== 'undefined') {
    window.addEventListener('load', function (e) {
        Zotero.Inspire.init();
    }, false);
}