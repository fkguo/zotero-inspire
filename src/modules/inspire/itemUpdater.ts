import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import {
  DOI_ORG_URL,
  INSPIRE_NOTE_HTML_ENTITIES,
} from "./constants";
import type { jsobject, ItemWithPendingInspireNote } from "./types";
import { getInspireMeta, getCrossrefCount } from "./metadataService";

// ─────────────────────────────────────────────────────────────────────────────
// ZInspire Class - Batch Update Controller
// ─────────────────────────────────────────────────────────────────────────────

export class ZInspire {
  current: number;
  toUpdate: number;
  itemsToUpdate: Zotero.Item[];
  numberOfUpdatedItems: number;
  counter: number;
  CrossRefcounter: number;
  noRecidCount: number;
  error_norecid: boolean;
  error_norecid_shown: boolean;
  final_count_shown: boolean;
  progressWindow: ProgressWindowHelper;
  private isCancelled: boolean = false;

  constructor(
    current: number = -1,
    toUpdate: number = 0,
    itemsToUpdate: Zotero.Item[] = [],
    numberOfUpdatedItems: number = 0,
    counter: number = 0,
    CrossRefcounter: number = 0,
    noRecidCount: number = 0,
    error_norecid: boolean = false,
    error_norecid_shown: boolean = false,
    final_count_shown: boolean = false,
  ) {
    this.current = current;
    this.toUpdate = toUpdate;
    this.itemsToUpdate = itemsToUpdate;
    this.numberOfUpdatedItems = numberOfUpdatedItems;
    this.counter = counter;
    this.CrossRefcounter = CrossRefcounter;
    this.noRecidCount = noRecidCount;
    this.error_norecid = error_norecid;
    this.error_norecid_shown = error_norecid_shown;
    this.final_count_shown = final_count_shown;
    this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    });
  }

  resetState(operation: string) {
    if (operation === "initial") {
      if (this.progressWindow) {
        this.progressWindow.close();
      }
      this.current = -1;
      this.toUpdate = 0;
      this.itemsToUpdate = [];
      this.numberOfUpdatedItems = 0;
      this.counter = 0;
      this.CrossRefcounter = 0;
      this.noRecidCount = 0;
      this.error_norecid = false;
      this.error_norecid_shown = false;
      this.final_count_shown = false;
    } else {
      if (this.error_norecid) {
        this.progressWindow.close();
        const icon = "chrome://zotero/skin/cross.png";
        if (this.error_norecid && !this.error_norecid_shown) {
          const progressWindowNoRecid = new ztoolkit.ProgressWindow(
            config.addonName,
            { closeOnClick: true },
          );
          progressWindowNoRecid.changeHeadline("INSPIRE recid not found");
          const itemWord = this.noRecidCount === 1 ? "item" : "items";
          if (getPref("tag_enable") && getPref("tag_norecid") !== "") {
            progressWindowNoRecid.createLine({
              icon: icon,
              text: `No INSPIRE recid was found for ${this.noRecidCount} ${itemWord}. Tagged with '${getPref("tag_norecid")}'.`,
            });
          } else {
            progressWindowNoRecid.createLine({
              icon: icon,
              text: `No INSPIRE recid was found for ${this.noRecidCount} ${itemWord}.`,
            });
          }
          progressWindowNoRecid.show();
          progressWindowNoRecid.startCloseTimer(3000);
          this.error_norecid_shown = true;
        }
      } else {
        if (!this.final_count_shown) {
          const icon = "chrome://zotero/skin/tick.png";
          this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
            closeOnClick: true,
          });
          this.progressWindow.changeHeadline("Finished");
          if (operation === "full" || operation === "noabstract") {
            this.progressWindow.createLine({
              text: "INSPIRE metadata updated for " + this.counter + " items.",
              progress: 100,
            });
          } else if (operation === "citations") {
            this.progressWindow.createLine({
              text:
                "INSPIRE citations updated for " +
                this.counter +
                " items;\n" +
                "CrossRef citations updated for " +
                this.CrossRefcounter +
                " items.",
              progress: 100,
            });
          }
          this.progressWindow.show();
          this.progressWindow.startCloseTimer(3000);
          this.final_count_shown = true;
        }
      }
    }
  }

  cancelUpdate() {
    this.isCancelled = true;
  }

  updateSelectedItems(operation: string) {
    this.resetState("initial");
    this.isCancelled = false;
    const items = ZoteroPane.getSelectedItems();
    this.toUpdate = items.length;
    this.itemsToUpdate = items;
    this.updateItemsConcurrent(operation);
  }

  updateSelectedCollection(operation: string) {
    this.resetState("initial");
    this.isCancelled = false;
    const collection = ZoteroPane.getSelectedCollection();
    if (collection) {
      this.itemsToUpdate = collection.getChildItems();
      this.toUpdate = this.itemsToUpdate.length;
      this.updateItemsConcurrent(operation);
    }
  }

  async updateItems(items: Zotero.Item[], operation: string) {
    this.resetState("initial");
    this.isCancelled = false;
    const filteredItems = items.filter((item) => item.isRegularItem());
    this.itemsToUpdate = filteredItems;
    this.toUpdate = filteredItems.length;
    this.updateItemsConcurrent(operation);
  }

  /**
   * Concurrent item processor with controlled parallelism
   */
  private async updateItemsConcurrent(operation: string) {
    const CONCURRENCY = 3;
    let completed = 0;
    const total = this.itemsToUpdate.length;

    if (!total) {
      this.resetState(operation);
      return;
    }

    // Show initial progress
    this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    });
    this.progressWindow.createLine({
      text: `Processing 0 of ${total} items...`,
      progress: 0,
    });
    this.progressWindow.show();

    // Create a queue of pending items
    const queue = [...this.itemsToUpdate];
    let index = 0;

    const worker = async () => {
      while (index < queue.length && !this.isCancelled) {
        const currentIndex = index++;
        const item = queue[currentIndex];

        if (!item || !item.isRegularItem()) {
          completed++;
          continue;
        }

        try {
          await this.updateItemInternal(item, operation);
        } catch (err) {
          Zotero.debug(`[${config.addonName}] updateItemsConcurrent: error updating item ${item.id}: ${err}`);
        }

        completed++;

        // Update progress
        if (!this.isCancelled) {
          const percent = Math.round((completed / total) * 100);
          this.progressWindow.changeLine({
            text: `Processing ${completed} of ${total} items...`,
            progress: percent,
          });
        }
      }
    };

    try {
      // Start concurrent workers
      const workers: Promise<void>[] = [];
      const workerCount = Math.min(CONCURRENCY, total);
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: starting ${workerCount} workers`);
      for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
      }

      await Promise.all(workers);
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: all workers finished, completed=${completed}`);

      // Finish
      if (!this.isCancelled) {
        this.progressWindow.close();
        this.numberOfUpdatedItems = total;
        this.current = total - 1;
        this.resetState(operation);
        Zotero.debug(`[${config.addonName}] updateItemsConcurrent: done, counter=${this.counter}`);
      } else {
        // Cancelled - show stats
        this.progressWindow.close();
        this.numberOfUpdatedItems = total;
        this.current = total - 1;
        this.showCancelledStats(completed, total);
      }
    } catch (err) {
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: fatal error: ${err}`);
      try {
        this.progressWindow.close();
      } catch (_e) { /* ignore */ }
      this.numberOfUpdatedItems = this.toUpdate;
    }
  }

  /**
   * Show statistics when update was cancelled
   */
  private showCancelledStats(completed: number, total: number) {
    const statsWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    statsWindow.changeHeadline(getString("update-cancelled"));
    const icon = "chrome://zotero/skin/warning.png";
    statsWindow.createLine({
      icon: icon,
      text: getString("update-cancelled-stats", { args: { completed: completed.toString(), total: total.toString() } }),
    });
    statsWindow.show();
    statsWindow.startCloseTimer(5000);
  }

  // Legacy serial method (kept for reference)
  updateNextItem(operation: string) {
    this.numberOfUpdatedItems++;

    if (this.current === this.toUpdate - 1) {
      this.progressWindow.close();
      this.resetState(operation);
      return;
    }

    this.current++;

    const percent = Math.round((this.numberOfUpdatedItems / this.toUpdate) * 100);
    this.progressWindow.changeLine({ progress: percent });
    this.progressWindow.changeLine({
      text: "Item " + this.current + " of " + this.toUpdate,
    });
    this.progressWindow.show();

    this.updateItem(this.itemsToUpdate[this.current], operation);
  }

  /**
   * Internal method to update a single item (used by concurrent processor)
   */
  private async updateItemInternal(item: Zotero.Item, operation: string) {
    Zotero.debug(`[${config.addonName}] updateItemInternal: starting, item=${item.id}, operation=${operation}`);
    if (operation === "full" || operation === "noabstract" || operation === "citations") {
      Zotero.debug(`[${config.addonName}] updateItemInternal: calling getInspireMeta`);
      const metaInspire = await getInspireMeta(item, operation);
      Zotero.debug(`[${config.addonName}] updateItemInternal: getInspireMeta returned, recid=${metaInspire !== -1 ? (metaInspire as jsobject).recid : 'N/A'}`);
      if (metaInspire !== -1 && (metaInspire as jsobject).recid !== undefined) {
        if (item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
        }
        if (item.itemType === "report" || item.itemType === "preprint") {
          item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
        }
        if (item.itemType !== "book" && (metaInspire as jsobject).document_type == "book") {
          item.setType(Zotero.ItemTypes.getID("book") as number);
        }
        await setInspireMeta(item, metaInspire as jsobject, operation);
        await saveItemWithPendingInspireNote(item);
        this.counter++;
      } else {
        if (getPref("tag_enable") && getPref("tag_norecid") !== "" && !item.hasTag(getPref("tag_norecid") as string)) {
          item.addTag(getPref("tag_norecid") as string, 1);
          await item.saveTx();
        } else if (!getPref("tag_enable") && item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
          await item.saveTx();
        }
        this.error_norecid = true;
        this.noRecidCount++;
        if (operation === "citations") {
          const crossref_count = await setCrossRefCitations(item);
          await item.saveTx();
          if (crossref_count >= 0) {
            this.CrossRefcounter++;
          }
        }
      }
    }
  }

  async updateItem(item: Zotero.Item, operation: string) {
    if (operation === "full" || operation === "noabstract" || operation === "citations") {
      const metaInspire = await getInspireMeta(item, operation);
      if (metaInspire !== -1 && (metaInspire as jsobject).recid !== undefined) {
        if (item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
          item.saveTx();
        }
        if (item.itemType === "report" || item.itemType === "preprint") {
          item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
        }
        if (item.itemType !== "book" && (metaInspire as jsobject).document_type == "book") {
          item.setType(Zotero.ItemTypes.getID("book") as number);
        }
        await setInspireMeta(item, metaInspire as jsobject, operation);
        await saveItemWithPendingInspireNote(item);
        this.counter++;
      } else {
        if (getPref("tag_enable") && getPref("tag_norecid") !== "" && !item.hasTag(getPref("tag_norecid") as string)) {
          item.addTag(getPref("tag_norecid") as string, 1);
          item.saveTx();
        } else if (!getPref("tag_enable") && item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
          item.saveTx();
        }
        this.error_norecid = true;
        this.noRecidCount++;
        if (operation == "citations") {
          const crossref_count = await setCrossRefCitations(item);
          item.saveTx();
          if (crossref_count >= 0) {
            this.CrossRefcounter++;
          }
        }
      }
      this.updateNextItem(operation);
    } else {
      this.updateNextItem(operation);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Item Metadata Setting
// ─────────────────────────────────────────────────────────────────────────────

export async function setInspireMeta(
  item: Zotero.Item,
  metaInspire: jsobject,
  operation: string,
) {
  let extra = item.getField("extra") as string;
  const publication = item.getField("publicationTitle") as string;
  const citekey_pref = getPref("citekey");

  if (metaInspire.recid !== -1 && metaInspire.recid !== undefined) {
    if (operation === "full" || operation === "noabstract") {
      item.setField("archive", "INSPIRE");
      item.setField("archiveLocation", metaInspire.recid);

      if (metaInspire.journalAbbreviation) {
        if (item.itemType === "journalArticle") {
          item.setField("journalAbbreviation", metaInspire.journalAbbreviation);
        } else if (metaInspire.document_type[0] === "book" && item.itemType === "book") {
          item.setField("series", metaInspire.journalAbbreviation);
        } else {
          item.setField("publicationTitle", metaInspire.journalAbbreviation);
        }
      }
      if (metaInspire.volume) {
        if (metaInspire.document_type[0] == "book") {
          item.setField("seriesNumber", metaInspire.volume);
        } else {
          item.setField("volume", metaInspire.volume);
        }
      }
      if (metaInspire.pages && metaInspire.document_type[0] !== "book") {
        item.setField("pages", metaInspire.pages);
      }
      if (metaInspire.date) {
        item.setField("date", metaInspire.date);
      }
      if (metaInspire.issue) {
        item.setField("issue", metaInspire.issue);
      }
      if (metaInspire.DOI) {
        if (item.itemType === "journalArticle" || item.itemType === "preprint") {
          item.setField("DOI", metaInspire.DOI);
        } else {
          item.setField("url", `${DOI_ORG_URL}/${metaInspire.DOI}`);
        }
      }

      if (metaInspire.isbns && !item.getField("ISBN")) {
        item.setField("ISBN", metaInspire.isbns);
      }
      if (metaInspire.publisher && !item.getField("publisher") &&
          (item.itemType == "book" || item.itemType == "bookSection")) {
        item.setField("publisher", metaInspire.publisher);
      }

      if (!item.getField("title")) {
        item.setField("title", metaInspire.title);
      }
      if (!item.getCreator(0) || !(item.getCreator(0) as _ZoteroTypes.Item.Creator).firstName) {
        item.setCreators(metaInspire.creators);
      }

      if (metaInspire.arxiv) {
        const arxivId = metaInspire.arxiv.value;
        const _arxivReg = new RegExp(/^.*(arXiv:|_eprint:).*$(\n|)/gim);
        let arXivInfo = "";
        if (/^\d/.test(arxivId)) {
          const arxivPrimeryCategory = metaInspire.arxiv.categories[0];
          arXivInfo = `arXiv:${arxivId} [${arxivPrimeryCategory}]`;
        } else {
          arXivInfo = "arXiv:" + arxivId;
        }
        const numberOfArxiv = (extra.match(_arxivReg) || "").length;
        if (numberOfArxiv !== 1) {
          extra = extra.replace(_arxivReg, "");
          if (extra.endsWith("\n")) {
            extra += arXivInfo;
          } else {
            extra += "\n" + arXivInfo;
          }
        } else {
          extra = extra.replace(/^.*(arXiv:|_eprint:).*$/gim, arXivInfo);
        }

        if (!metaInspire.journalAbbreviation) {
          if (item.itemType == "journalArticle") {
            item.setField("journalAbbreviation", arXivInfo);
          }
          if (publication.startsWith("arXiv:")) {
            item.setField("publicationTitle", "");
          }
        }
        const url = item.getField("url");
        if (metaInspire.urlArxiv && !url) {
          item.setField("url", metaInspire.urlArxiv);
        }
      }

      extra = extra.replace(/^.*type: article.*$\n/gm, "");

      if (metaInspire.collaborations && !extra.includes("tex.collaboration")) {
        extra = extra + "\n" + "tex.collaboration: " + metaInspire.collaborations.join(", ");
      }

      extra = setCitations(
        extra,
        metaInspire.citation_count,
        metaInspire.citation_count_wo_self_citations,
      );

      await queueOrUpsertInspireNote(item, metaInspire.note);

      if (citekey_pref === "inspire") {
        if (extra.includes("Citation Key")) {
          const initialCiteKey = (extra.match(/^.*Citation\sKey:.*$/gm) || "")[0].split(": ")[1];
          if (initialCiteKey !== metaInspire.citekey) {
            extra = extra.replace(/^.*Citation\sKey.*$/gm, `Citation Key: ${metaInspire.citekey}`);
          }
        } else {
          extra += "\nCitation Key: " + metaInspire.citekey;
        }
      }
    }

    if (operation === "full" && metaInspire.abstractNote) {
      item.setField("abstractNote", metaInspire.abstractNote);
    }

    if (operation === "citations") {
      extra = setCitations(
        extra,
        metaInspire.citation_count,
        metaInspire.citation_count_wo_self_citations,
      );
    }
    extra = extra.replace(/\n\n/gm, "\n");
    extra = reorderExtraFields(extra);
    item.setField("extra", extra);

    setArxivCategoryTag(item);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Note Management
// ─────────────────────────────────────────────────────────────────────────────

async function queueOrUpsertInspireNote(item: Zotero.Item, noteText?: string) {
  const trimmed = noteText?.trim();
  const itemWithPending = item as ItemWithPendingInspireNote;

  if (!trimmed || trimmed === "[]") {
    delete itemWithPending._zinspirePendingInspireNote;
    return;
  }

  if (!item.id) {
    itemWithPending._zinspirePendingInspireNote = trimmed;
    return;
  }

  await upsertInspireNote(item, trimmed);
  delete itemWithPending._zinspirePendingInspireNote;
}

async function flushPendingInspireNote(item: Zotero.Item) {
  const itemWithPending = item as ItemWithPendingInspireNote;
  if (item.id && itemWithPending._zinspirePendingInspireNote) {
    await upsertInspireNote(item, itemWithPending._zinspirePendingInspireNote);
    delete itemWithPending._zinspirePendingInspireNote;
  }
}

export async function saveItemWithPendingInspireNote(item: Zotero.Item) {
  await item.saveTx();
  await flushPendingInspireNote(item);
}

async function upsertInspireNote(item: Zotero.Item, noteText: string) {
  if (!item.id) {
    return;
  }

  const normalizedTarget = normalizeInspireNoteContent(noteText);
  if (!normalizedTarget) {
    return;
  }

  const noteIDs = item.getNotes();
  let exactMatch: Zotero.Item | undefined;
  let fallbackMatch: Zotero.Item | undefined;
  const targetLooksLikeErratum = normalizedTarget.includes("erratum");

  for (const id of noteIDs) {
    const note = Zotero.Items.get(id);
    const normalizedExisting = normalizeInspireNoteContent(note.getNote());
    if (!normalizedExisting) {
      continue;
    }

    if (normalizedExisting === normalizedTarget) {
      exactMatch = note;
      break;
    }

    if (!fallbackMatch && targetLooksLikeErratum && normalizedExisting.includes("erratum")) {
      fallbackMatch = note;
    }
  }

  const noteToUpdate = exactMatch ?? fallbackMatch;
  if (noteToUpdate) {
    if (noteToUpdate.getNote() !== noteText) {
      noteToUpdate.setNote(noteText);
      await noteToUpdate.saveTx();
    }
    return;
  }

  const newNote = new Zotero.Item("note");
  newNote.setNote(noteText);
  newNote.parentID = item.id;
  newNote.libraryID = item.libraryID;
  await newNote.saveTx();
}

function normalizeInspireNoteContent(note?: string): string {
  if (!note) {
    return "";
  }

  const withoutTags = note
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  const decoded = withoutTags.replace(
    /&([a-z]+);/gi,
    (_match, entity: string) => INSPIRE_NOTE_HTML_ENTITIES[entity.toLowerCase()] ?? " ",
  );

  return decoded
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation Management
// ─────────────────────────────────────────────────────────────────────────────

function setExtraCitations(extra: any, source: string, citation_count: any) {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

  const topLineMatch = extra.match(/^(\d+)\scitations\s\([\w\s]+[\d/-]+\)\n/);
  if (topLineMatch) {
    const topCitation = Number(topLineMatch[1]);
    if (citation_count === topCitation) {
      return extra;
    }
  }

  const temp = extra.match(/^\d+\scitations/gm);
  let existingCitation = 0;
  if (temp !== null && temp.length > 0) {
    existingCitation = Number(temp[0].replace(" citations", ""));
  }

  const dateMatch = extra.match(new RegExp(`${source}\\s([\\d/-]+)`));
  const existingDate = dateMatch ? dateMatch[1] : today;

  extra = extra.replace(/^.*citations.*$\n?/gm, "");
  extra = extra.replace(/^\n+/, "");

  if (citation_count === existingCitation) {
    extra = `${citation_count} citations (${source} ${existingDate})\n` + extra;
  } else {
    extra = `${citation_count} citations (${source} ${today})\n` + extra;
  }

  return extra;
}

export async function setCrossRefCitations(item: Zotero.Item): Promise<number> {
  let extra = item.getField("extra");
  let count_crossref = await getCrossrefCount(item);
  if (count_crossref >= 0) {
    extra = setExtraCitations(extra, "CrossRef", count_crossref) as string;
    extra = extra.replace(/\n\n/gm, "\n");
    extra = reorderExtraFields(extra);
    item.setField("extra", extra);
    setArxivCategoryTag(item);
  } else {
    count_crossref = -1;
  }
  return count_crossref;
}

function reorderExtraFields(extra: string): string {
  const order_pref = getPref("extra_order");

  if (order_pref === "citations_first") {
    return extra;
  }

  const citationLines: string[] = [];
  const arxivLines: string[] = [];
  const otherLines: string[] = [];

  const lines = extra.split("\n");
  for (const line of lines) {
    if (line.match(/^\d+\scitations/)) {
      citationLines.push(line);
    } else if (line.match(/^(arXiv:|_eprint:)/i)) {
      arxivLines.push(line);
    } else if (line.trim() !== "") {
      otherLines.push(line);
    }
  }

  const reordered = [...arxivLines, ...otherLines, ...citationLines];
  return reordered.join("\n");
}

function setCitations(
  extra: string,
  citation_count: number,
  citation_count_wo_self_citations: number,
): string {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

  const topLinesMatch = extra.match(
    /^(\d+)\scitations\s\(INSPIRE\s[\d/-]+\)\n(\d+)\scitations\sw\/o\sself\s\(INSPIRE\s[\d/-]+\)\n/,
  );

  if (topLinesMatch) {
    const topCitation = Number(topLinesMatch[1]);
    const topCitationWoSelf = Number(topLinesMatch[2]);
    if (citation_count === topCitation && citation_count_wo_self_citations === topCitationWoSelf) {
      return extra;
    }
  }

  const temp = extra.match(/^\d+\scitations/gm);
  let existingCitations: number[] = [0, 0];
  if (temp !== null && temp.length >= 2) {
    existingCitations = temp.map((e: any) => Number(e.replace(" citations", "")));
  }

  const dateMatch = extra.match(/INSPIRE\s([\d/-]+)/);
  const existingDate = dateMatch ? dateMatch[1] : today;

  extra = extra.replace(/^.*citations.*$\n?/gm, "");
  extra = extra.replace(/^\n+/, "");

  if (citation_count === existingCitations[0] && citation_count_wo_self_citations === existingCitations[1]) {
    extra =
      `${citation_count} citations (INSPIRE ${existingDate})\n` +
      `${citation_count_wo_self_citations} citations w/o self (INSPIRE ${existingDate})\n` +
      extra;
  } else {
    extra =
      `${citation_count} citations (INSPIRE ${today})\n` +
      `${citation_count_wo_self_citations} citations w/o self (INSPIRE ${today})\n` +
      extra;
  }

  return extra;
}

// ─────────────────────────────────────────────────────────────────────────────
// arXiv Tag Management
// ─────────────────────────────────────────────────────────────────────────────

function setArxivCategoryTag(item: Zotero.Item) {
  const arxiv_tag_pref = getPref("arxiv_tag_enable");
  if (!arxiv_tag_pref) {
    return;
  }

  const extra = item.getField("extra") as string;
  let primaryCategory = "";

  const newFormatMatch = extra.match(/arXiv:\d{4}\.\d{4,5}\s*\[([^\]]+)\]/i);
  if (newFormatMatch) {
    primaryCategory = newFormatMatch[1];
  } else {
    const oldFormatMatch = extra.match(/arXiv:([a-z-]+)\/\d{7}/i);
    if (oldFormatMatch) {
      primaryCategory = oldFormatMatch[1];
    }
  }

  if (primaryCategory) {
    if (!item.hasTag(primaryCategory)) {
      item.addTag(primaryCategory);
      item.saveTx();
    }
  }
}

