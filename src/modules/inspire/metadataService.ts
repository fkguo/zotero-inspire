import { config } from "../../../package.json";
import { cleanMathTitle } from "../../utils/mathTitle";
import {
  INSPIRE_API_BASE,
  ARXIV_ABS_URL,
  CROSSREF_API_URL,
} from "./constants";
import type { jsobject } from "./types";
import { recidLookupCache } from "./apiUtils";

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE Metadata Fetching
// ─────────────────────────────────────────────────────────────────────────────

export async function getInspireMeta(item: Zotero.Item, operation: string): Promise<jsobject | -1> {
  const doi0 = item.getField("DOI") as string;
  let doi = doi0;
  const url = item.getField("url") as string;
  const extra = item.getField("extra") as string;
  let searchOrNot = 0;

  let idtype = "doi";
  const arxivReg = new RegExp(/arxiv/i);
  if (!doi || arxivReg.test(doi)) {
    if (extra.includes("arXiv:") || extra.includes("_eprint:")) {
      // arXiv number from Extra
      idtype = "arxiv";
      const regexArxivId = /(arXiv:|_eprint:)(.+)/;
      if (extra.match(regexArxivId)) {
        const arxiv_split = (extra.match(regexArxivId) || "   ")[2].split(" ");
        if (arxiv_split[0] === "") {
          doi = arxiv_split[1];
        } else {
          doi = arxiv_split[0];
        }
      }
    } else if (/(doi|arxiv|\/literature\/)/i.test(url)) {
      const patt = /(?:arxiv.org[/]abs[/]|arXiv:)([a-z.-]+[/]\d+|\d+[.]\d+)/i;
      const m = patt.exec(url);
      if (!m) {
        if (/doi/i.test(url)) {
          doi = url.replace(/^.+doi.org\//, "");
        } else if (url.includes("/literature/")) {
          const _recid = /[^/]*$/.exec(url) || "    ";
          if (_recid[0].match(/^\d+/)) {
            idtype = "literature";
            doi = _recid[0];
          }
        }
      } else {
        idtype = "arxiv";
        doi = m[1];
      }
    } else if (/DOI:/i.test(extra)) {
      const regexDOIinExtra = /DOI:(.+)/i;
      doi = (extra.match(regexDOIinExtra) || "")[1].trim();
    } else if (/doi\.org\//i.test(extra)) {
      const regexDOIinExtra = /doi\.org\/(.+)/i;
      doi = (extra.match(regexDOIinExtra) || "")[1];
    } else {
      const _recid = item.getField("archiveLocation") as string;
      if (_recid.match(/^\d+/)) {
        idtype = "literature";
        doi = _recid;
      }
    }
  } else if (/doi/i.test(doi)) {
    doi = doi.replace(/^.+doi.org\//, "");
  }

  if (!doi && extra.includes("Citation Key:")) searchOrNot = 1;
  const t0 = performance.now();

  let urlInspire = "";
  if (searchOrNot === 0) {
    const edoi = encodeURIComponent(doi);
    urlInspire = `${INSPIRE_API_BASE}/${idtype}/${edoi}`;
  } else if (searchOrNot === 1) {
    const citekey = (extra.match(/^.*Citation\sKey:.*$/gm) || "")[0].split(": ")[1];
    urlInspire = `${INSPIRE_API_BASE}/literature?q=texkey%20${encodeURIComponent(citekey)}`;
  }

  if (!urlInspire) {
    return -1;
  }

  let status: number | null = null;
  const response = (await fetch(urlInspire)
    .then((response) => {
      if (response.status !== 404) {
        status = 1;
        return response.json();
      }
    })
    .catch((_err) => null)) as any;

  if (status === null) {
    return -1;
  }

  const t1 = performance.now();
  Zotero.debug(`Fetching INSPIRE meta took ${t1 - t0} milliseconds.`);

  try {
    const meta = (() => {
      if (searchOrNot === 0) {
        return response["metadata"];
      } else {
        const hits = response["hits"].hits;
        if (hits.length === 1) return hits[0].metadata;
      }
    })();
    if (!meta) {
      return -1;
    }
    const assignStart = performance.now();
    const metaInspire = buildMetaFromMetadata(meta, operation);
    if (operation !== "citations") {
      const assignEnd = performance.now();
      Zotero.debug(`Assigning meta took ${assignEnd - assignStart} milliseconds.`);
    }
    return metaInspire;
  } catch (err) {
    return -1;
  }
}

export async function fetchRecidFromInspire(item: Zotero.Item): Promise<string | null> {
  // Validate item.id before using as cache key
  if (typeof item.id !== "number" || !Number.isFinite(item.id)) {
    Zotero.debug(`[${config.addonName}] Invalid item.id: ${item.id}, skipping cache`);
    const meta = (await getInspireMeta(item, "literatureLookup")) as jsobject | -1;
    if (meta === -1 || typeof meta !== "object") return null;
    return (meta.recid as string | undefined | null) ?? null;
  }

  // Check cache first to avoid redundant API calls
  const cached = recidLookupCache.get(item.id);
  if (cached !== undefined) {
    Zotero.debug(`[${config.addonName}] Using cached recid for item ${item.id}: ${cached}`);
    return cached;
  }

  const meta = (await getInspireMeta(item, "literatureLookup")) as jsobject | -1;
  if (meta === -1 || typeof meta !== "object") {
    return null;
  }
  const recid = meta.recid as string | undefined | null;
  if (recid) {
    recidLookupCache.set(item.id, recid);
  }
  return recid ?? null;
}

export async function fetchInspireMetaByRecid(
  recid: string,
  signal?: AbortSignal,
  operation: string = "full",
  minimal: boolean = false,
): Promise<jsobject | -1> {
  let url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}`;
  if (minimal) {
    url += "?fields=metadata.title,metadata.creators,metadata.date";
  }
  const response = await fetch(url, { signal }).catch(() => null);
  if (!response || response.status === 404) {
    return -1;
  }
  const payload: any = await response.json();
  const meta = payload?.metadata;
  if (!meta) {
    return -1;
  }
  try {
    return buildMetaFromMetadata(meta, operation);
  } catch (_err) {
    return -1;
  }
}

/**
 * Fetch only the abstract for a given recid from INSPIRE API.
 */
export async function fetchInspireAbstract(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const meta = await fetchInspireMetaByRecid(recid, signal, "full").catch(() => -1);
  if (meta !== -1 && meta) {
    const abstract = (meta as jsobject).abstractNote;
    if (typeof abstract === "string" && abstract.trim()) {
      return abstract.trim();
    }
  }
  return await fetchAbstractDirect(recid, signal);
}

async function fetchAbstractDirect(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?fields=metadata.abstracts`;
  try {
    const response = await fetch(url, { signal }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    const payload: any = await response.json();
    const abstracts = payload?.metadata?.abstracts;
    if (Array.isArray(abstracts) && abstracts.length) {
      const preferred =
        abstracts.find((a) => (a?.language || "").toLowerCase() === "en") ||
        abstracts.find((a) => a?.source === "arXiv") ||
        abstracts[0];
      const text = (preferred?.value || "").trim();
      return text || null;
    }
  } catch (_err) {
    return null;
  }
  return null;
}

/**
 * Fetch BibTeX entry for a given INSPIRE recid.
 */
export async function fetchBibTeX(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?format=bibtex`;
  try {
    const response = await fetch(url, { signal }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    const bibtex = await response.text();
    return bibtex?.trim() || null;
  } catch (_err) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CrossRef Integration
// ─────────────────────────────────────────────────────────────────────────────

export async function getCrossrefCount(item: Zotero.Item): Promise<number> {
  const doi = item.getField("DOI");
  if (!doi) {
    return -1;
  }
  const edoi = encodeURIComponent(doi);

  const t0 = performance.now();
  let response: any = null;

  if (response === null) {
    const style = "vnd.citationstyles.csl+json";
    const xform = "transform/application/" + style;
    const url = `${CROSSREF_API_URL}/${edoi}/${xform}`;
    response = await fetch(url)
      .then((response) => response.json())
      .catch((_err) => null);
  }

  if (response === null) {
    const url = "https://doi.org/" + edoi;
    const style = "vnd.citationstyles.csl+json";
    response = await fetch(url, {
      headers: {
        Accept: "application/" + style,
      },
    })
      .then((response) => response.json())
      .catch((_err) => null);
  }

  if (response === null) {
    return -1;
  }

  const t1 = performance.now();
  Zotero.debug(`Fetching CrossRef meta took ${t1 - t0} milliseconds.`);

  let str = null;
  try {
    str = response["is-referenced-by-count"];
  } catch (err) {
    return -1;
  }

  const count = str ? parseInt(str) : -1;
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Building
// ─────────────────────────────────────────────────────────────────────────────

export function buildMetaFromMetadata(meta: any, operation: string): jsobject {
  if (!meta) {
    throw new Error("Missing metadata");
  }
  const metaInspire: jsobject = {};
  metaInspire.recid = meta["control_number"];
  metaInspire.citation_count = meta["citation_count"];
  metaInspire.citation_count_wo_self_citations = meta["citation_count_without_self_citations"];

  if (operation !== "citations") {
    if (meta["dois"]) {
      metaInspire.DOI = meta["dois"][0].value;
    }

    if (meta["publication_info"]) {
      const publicationInfo = meta["publication_info"];
      const first = publicationInfo[0];
      if (first?.journal_title) {
        const jAbbrev = first.journal_title as string;
        metaInspire.journalAbbreviation = jAbbrev.replace(/\.\s|\./g, ". ");
        if (first.journal_volume) {
          metaInspire.volume = first.journal_volume;
        }
        if (first.artid) {
          metaInspire.pages = first.artid;
        } else if (first.page_start) {
          metaInspire.pages = first.page_start;
          if (first.page_end) {
            metaInspire.pages = metaInspire.pages + "-" + first.page_end;
          }
        }
        metaInspire.date = first.year;
        metaInspire.issue = first.journal_issue;
      }

      if (publicationInfo.length > 1) {
        const errNotes: string[] = [];
        for (let i = 1; i < publicationInfo.length; i++) {
          const next = publicationInfo[i];
          if (next.material === "erratum") {
            const jAbbrev = next.journal_title;
            let pagesErr = "";
            if (next.artid) {
              pagesErr = next.artid;
            } else if (next.page_start) {
              pagesErr = next.page_start;
              if (next.page_end) {
                pagesErr = pagesErr + "-" + next.page_end;
              }
            }
            errNotes[i - 1] = `Erratum: ${jAbbrev} ${next.journal_volume}, ${pagesErr} (${next.year})`;
          } else if (next.journal_title && (next.page_start || next.artid)) {
            let pagesNext = "";
            if (next.page_start) {
              pagesNext = next.page_start;
              if (next.page_end) {
                pagesNext = pagesNext + "-" + next.page_end;
              }
            } else if (next.artid) {
              pagesNext = next.artid;
            }
            errNotes[i - 1] = `${next.journal_title}  ${next.journal_volume} (${next.year}) ${pagesNext}`;
          }
          if (next.pubinfo_freetext) {
            errNotes[i - 1] = next.pubinfo_freetext;
          }
        }
        if (errNotes.length > 0) {
          metaInspire.note = `[${errNotes.join(", ")}]`;
        }
      }
    }

    const metaArxiv = meta["arxiv_eprints"];
    if (metaArxiv) {
      metaInspire.arxiv = metaArxiv[0];
      metaInspire.urlArxiv = `${ARXIV_ABS_URL}/${metaInspire.arxiv.value}`;
    }

    const metaAbstract = meta["abstracts"];
    if (metaAbstract) {
      metaInspire.abstractNote = metaAbstract[0].value;
      for (let i = 0; i < metaAbstract.length; i++) {
        if (metaAbstract[i].source === "arXiv") {
          metaInspire.abstractNote = metaAbstract[i].value;
          break;
        }
      }
    }

    const rawTitle = meta["titles"]?.[0]?.title;
    metaInspire.title = rawTitle ? cleanMathTitle(rawTitle) : rawTitle;
    metaInspire.document_type = meta["document_type"];
    metaInspire.citekey = meta["texkeys"]?.[0];
    if (meta["isbns"]) {
      metaInspire.isbns = meta["isbns"].map((e: any) => e.value);
    }
    if (meta["imprints"]) {
      const imprint = meta["imprints"][0];
      if (imprint.publisher) {
        metaInspire.publisher = imprint.publisher;
      }
      if (imprint.date) {
        metaInspire.date = imprint.date;
      }
    }

    const creators: any[] = [];
    const metaCol = meta["collaborations"];
    if (metaCol) {
      metaInspire.collaborations = metaCol.map((e: any) => e.value);
    }

    const metaAuthors = meta["authors"];
    if (metaAuthors?.length) {
      const authorCount = meta["author_count"] || metaAuthors.length;
      let maxAuthorCount = authorCount;
      if (authorCount > 10) {
        maxAuthorCount = 3;
      }
      for (let j = 0; j < maxAuthorCount; j++) {
        const [lastName, firstName] = metaAuthors[j].full_name.split(", ");
        creators[j] = {
          firstName,
          lastName,
          creatorType: metaAuthors[j].inspire_roles
            ? metaAuthors[j].inspire_roles[0]
            : "author",
        };
      }
      if (authorCount > 10) {
        creators.push({
          name: "others",
          creatorType: "author",
        });
      }
    } else if (metaCol) {
      for (let i = 0; i < metaCol.length; i++) {
        creators[i] = {
          name: metaInspire.collaborations[i],
          creatorType: "author",
        };
      }
    }
    metaInspire.creators = creators;
  }

  return metaInspire;
}

