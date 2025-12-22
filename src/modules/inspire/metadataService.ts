import { config } from "../../../package.json";
import { cleanMathTitle } from "../../utils/mathTitle";
import {
  INSPIRE_API_BASE,
  ARXIV_ABS_URL,
  CROSSREF_API_URL,
  API_FIELDS_CITATIONS,
  API_FIELDS_FULL_UPDATE,
  API_FIELDS_AUTO_CHECK,
  API_FIELDS_LOOKUP,
  buildFieldsParam,
} from "./constants";
import type { jsobject } from "./types";
import type {
  InspireAbstract,
  InspireLiteratureMetadata,
} from "./apiTypes";
import { recidLookupCache } from "./apiUtils";
import { inspireFetch } from "./rateLimiter";
import { crossrefFetch } from "./crossrefService";
import { LRUCache } from "./utils";
import { localCache } from "./localCache";

// ─────────────────────────────────────────────────────────────────────────────
// RegExp Constants (hoisted to module level for performance)
// ─────────────────────────────────────────────────────────────────────────────
const ARXIV_REGEX = /arxiv/i;
const ARXIV_ID_REGEX = /(arXiv:|_eprint:)(.+)/;
const ARXIV_URL_REGEX =
  /(?:arxiv.org[/]abs[/]|arXiv:)([a-z.-]+[/]\d+|\d+[.]\d+)/i;
const RECID_FROM_URL_REGEX = /[^/]*$/;
const DOI_IN_EXTRA_REGEX = /DOI:(.+)/i;
const DOI_ORG_IN_EXTRA_REGEX = /doi\.org\/(.+)/i;
const URL_IDENTIFIER_REGEX = /(doi|arxiv|\/literature\/)/i;

// ─────────────────────────────────────────────────────────────────────────────
// Identifier Extraction (FTR-REFACTOR: Extracted for clarity)
// ─────────────────────────────────────────────────────────────────────────────

interface ExtractedIdentifier {
  idtype: "doi" | "arxiv" | "literature";
  value: string;
  searchOrNot: 0 | 1;
}

/**
 * Extract identifier (DOI, arXiv, or recid) from a Zotero item.
 * Checks multiple fields: DOI, URL, Extra, archiveLocation.
 *
 * @param item - Zotero item to extract identifier from
 * @returns Extracted identifier info, or null if not found
 */
function extractIdentifierFromItem(
  item: Zotero.Item,
): ExtractedIdentifier | null {
  const doi0 = item.getField("DOI") as string;
  const url = item.getField("url") as string;
  const extra = item.getField("extra") as string;

  // DOI from DOI field (if not an arXiv link)
  if (doi0 && !ARXIV_REGEX.test(doi0)) {
    const cleanDoi = doi0.replace(/^.+doi.org\//, "");
    return { idtype: "doi", value: cleanDoi, searchOrNot: 0 };
  }

  // arXiv from Extra field
  if (extra.includes("arXiv:") || extra.includes("_eprint:")) {
    const match = extra.match(ARXIV_ID_REGEX);
    if (match) {
      const arxivSplit = match[2].split(" ");
      const arxivId = arxivSplit[0] === "" ? arxivSplit[1] : arxivSplit[0];
      return { idtype: "arxiv", value: arxivId, searchOrNot: 0 };
    }
  }

  // Check URL for various identifiers
  if (URL_IDENTIFIER_REGEX.test(url)) {
    // arXiv from URL
    const arxivUrlMatch = ARXIV_URL_REGEX.exec(url);
    if (arxivUrlMatch) {
      return { idtype: "arxiv", value: arxivUrlMatch[1], searchOrNot: 0 };
    }

    // DOI from URL
    if (/doi/i.test(url)) {
      const cleanDoi = url.replace(/^.+doi.org\//, "");
      return { idtype: "doi", value: cleanDoi, searchOrNot: 0 };
    }

    // Literature recid from URL
    if (url.includes("/literature/")) {
      const recidMatch = RECID_FROM_URL_REGEX.exec(url);
      if (recidMatch?.[0]?.match(/^\d+/)) {
        return { idtype: "literature", value: recidMatch[0], searchOrNot: 0 };
      }
    }
  }

  // DOI from Extra field
  const doiInExtra = extra.match(DOI_IN_EXTRA_REGEX);
  if (doiInExtra) {
    return { idtype: "doi", value: doiInExtra[1].trim(), searchOrNot: 0 };
  }

  const doiOrgInExtra = extra.match(DOI_ORG_IN_EXTRA_REGEX);
  if (doiOrgInExtra) {
    return { idtype: "doi", value: doiOrgInExtra[1], searchOrNot: 0 };
  }

  // Recid from archiveLocation
  const recid = item.getField("archiveLocation") as string;
  if (recid?.match(/^\d+/)) {
    return { idtype: "literature", value: recid, searchOrNot: 0 };
  }

  // Fallback to citation key search
  if (extra.includes("Citation Key:")) {
    return { idtype: "doi", value: "", searchOrNot: 1 };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE Metadata Fetching
// ─────────────────────────────────────────────────────────────────────────────

export async function getInspireMeta(
  item: Zotero.Item,
  operation: string,
  signal?: AbortSignal,
): Promise<jsobject | -1> {
  const identifier = extractIdentifierFromItem(item);
  if (!identifier) {
    return -1;
  }

  const { idtype, value: doi, searchOrNot } = identifier;
  const extra = item.getField("extra") as string;
  const t0 = performance.now();

  // FTR-API-FIELD-OPTIMIZATION: Select fields based on operation type
  let fieldsParam = "";
  if (operation === "citations") {
    fieldsParam = buildFieldsParam(API_FIELDS_CITATIONS);
  } else if (operation === "literatureLookup") {
    fieldsParam = buildFieldsParam(API_FIELDS_LOOKUP);
  } else if (operation === "autoCheck") {
    // Lightweight fields for smart update comparison (no abstracts)
    fieldsParam = buildFieldsParam(API_FIELDS_AUTO_CHECK);
  } else {
    // For full update or abstract operations, use full fields
    fieldsParam = buildFieldsParam(API_FIELDS_FULL_UPDATE);
  }

  let urlInspire = "";
  if (searchOrNot === 0) {
    const edoi = encodeURIComponent(doi);
    urlInspire = `${INSPIRE_API_BASE}/${idtype}/${edoi}${fieldsParam ? "?" + fieldsParam.slice(1) : ""}`;
  } else if (searchOrNot === 1) {
    const citekeyMatch = extra.match(/^.*Citation\sKey:\s*(.+)$/m);
    const citekey = citekeyMatch?.[1]?.trim();
    if (!citekey) {
      return -1;
    }
    urlInspire = `${INSPIRE_API_BASE}/literature?q=texkey%20${encodeURIComponent(citekey)}${fieldsParam}`;
  }

  if (!urlInspire) {
    return -1;
  }

  let status: number | null = null;
  const response = (await inspireFetch(urlInspire, { signal })
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
      Zotero.debug(
        `Assigning meta took ${assignEnd - assignStart} milliseconds.`,
      );
    }
    return metaInspire;
  } catch (err) {
    return -1;
  }
}

export async function fetchRecidFromInspire(
  item: Zotero.Item,
  signal?: AbortSignal,
): Promise<string | null> {
  // Validate item.id before using as cache key
  if (typeof item.id !== "number" || !Number.isFinite(item.id)) {
    Zotero.debug(
      `[${config.addonName}] Invalid item.id: ${item.id}, skipping cache`,
    );
    const meta = (await getInspireMeta(item, "literatureLookup", signal)) as
      | jsobject
      | -1;
    if (meta === -1 || typeof meta !== "object") return null;
    // FIX: INSPIRE API returns recid as number, convert to string
    return meta.recid != null ? String(meta.recid) : null;
  }

  // Check cache first to avoid redundant API calls
  const cached = recidLookupCache.get(item.id);
  if (cached !== undefined) {
    Zotero.debug(
      `[${config.addonName}] Using cached recid for item ${item.id}: ${cached}`,
    );
    return cached;
  }

  const meta = (await getInspireMeta(item, "literatureLookup", signal)) as
    | jsobject
    | -1;
  if (meta === -1 || typeof meta !== "object") {
    return null;
  }
  // FIX: INSPIRE API returns recid as number, convert to string
  const recid = meta.recid != null ? String(meta.recid) : null;
  if (recid) {
    recidLookupCache.set(item.id, recid);
  }
  return recid;
}

export async function fetchInspireMetaByRecid(
  recid: string,
  signal?: AbortSignal,
  operation: string = "full",
  minimal: boolean = false,
): Promise<jsobject | -1> {
  // FTR-API-FIELD-OPTIMIZATION: Select fields based on operation type
  let fieldsParam = "";
  if (minimal) {
    fieldsParam = "?fields=metadata.title,metadata.creators,metadata.date";
  } else if (operation === "citations") {
    fieldsParam = buildFieldsParam(API_FIELDS_CITATIONS).replace("&", "?");
  } else if (operation === "autoCheck") {
    // Lightweight fields for smart update comparison (no abstracts)
    fieldsParam = buildFieldsParam(API_FIELDS_AUTO_CHECK).replace("&", "?");
  } else {
    fieldsParam = buildFieldsParam(API_FIELDS_FULL_UPDATE).replace("&", "?");
  }

  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}${fieldsParam}`;
  const response = await inspireFetch(url, { signal }).catch(() => null);
  if (!response || response.status === 404) {
    return -1;
  }
  const payload = (await response.json()) as {
    metadata?: InspireLiteratureMetadata & { recid?: string | number };
  };
  const meta = payload.metadata;
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
 * FTR-PERF-ABSTRACT: Uses lightweight endpoint (only abstracts field) instead
 * of full metadata fetch to improve performance for hover preview and tooltips.
 */
export async function fetchInspireAbstract(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // Use lightweight fetch that only requests abstracts field
  return await fetchAbstractDirect(recid, signal);
}

async function fetchAbstractDirect(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?fields=metadata.abstracts`;
  try {
    const response = await inspireFetch(url, { signal }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      metadata?: { abstracts?: InspireAbstract[] };
    };
    const abstracts = payload.metadata?.abstracts;
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
    const response = await inspireFetch(url, { signal }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    const bibtex = await response.text();
    return bibtex?.trim() || null;
  } catch (_err) {
    return null;
  }
}

/**
 * Fetch texkey for a given INSPIRE recid.
 * Uses lightweight fields query to avoid full metadata payload.
 */
export async function fetchInspireTexkey(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?fields=metadata.texkeys`;
  try {
    const response = await inspireFetch(url, { signal }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      metadata?: { texkeys?: string[] };
    };
    const texkeys = payload.metadata?.texkeys;
    if (Array.isArray(texkeys) && texkeys.length) {
      return typeof texkeys[0] === "string" ? texkeys[0] : null;
    }
  } catch (_err) {
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CrossRef Integration
// ─────────────────────────────────────────────────────────────────────────────

const crossrefCountCache = new LRUCache<string, number>(200);

export async function getCrossrefCount(
  item: Zotero.Item,
  signal?: AbortSignal,
): Promise<number> {
  const doi = item.getField("DOI");
  if (!doi) {
    return -1;
  }
  const edoi = encodeURIComponent(doi);

  const t0 = performance.now();
  let response: any = null;

  const normalizedDoi = doi.toLowerCase();

  // Memory cache
  const cachedMem = crossrefCountCache.get(normalizedDoi);
  if (cachedMem !== undefined) {
    return cachedMem;
  }

  // Disk cache (TTL from prefs, default 24h)
  const cachedDisk = await localCache.get<number>(
    "crossref",
    normalizedDoi,
    undefined,
    { ignoreTTL: false },
  );
  if (cachedDisk?.data !== undefined) {
    crossrefCountCache.set(normalizedDoi, cachedDisk.data);
    return cachedDisk.data;
  }

  // Try CrossRef API first
  if (response === null) {
    const style = "vnd.citationstyles.csl+json";
    const xform = "transform/application/" + style;
    const url = `${CROSSREF_API_URL}/${edoi}/${xform}`;
    const fetchResponse = await crossrefFetch(url, { signal });
    response = fetchResponse
      ? await fetchResponse.json().catch(() => null)
      : null;
  }

  // Fallback to DOI.org with Accept header
  if (response === null) {
    const url = "https://doi.org/" + edoi;
    const style = "vnd.citationstyles.csl+json";
    const fetchResponse = await crossrefFetch(url, {
      headers: {
        Accept: "application/" + style,
      },
      signal,
    });
    response = fetchResponse
      ? await fetchResponse.json().catch(() => null)
      : null;
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

  if (count >= 0) {
    crossrefCountCache.set(normalizedDoi, count);
    await localCache.set("crossref", normalizedDoi, count);
  }

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
  metaInspire.citation_count_wo_self_citations =
    meta["citation_count_without_self_citations"];

  if (operation !== "citations") {
    if (meta["dois"]) {
      metaInspire.DOI = meta["dois"][0].value;
    }

    if (meta["publication_info"]) {
      const publicationInfo = meta["publication_info"];

      // Find the primary publication entry (first one with journal_title that's not erratum)
      // Some INSPIRE records have pubinfo_freetext in [0] and structured data in [1]
      const primaryIdx = publicationInfo.findIndex(
        (p: any) => p.journal_title && p.material !== "erratum",
      );
      const primary = primaryIdx >= 0 ? publicationInfo[primaryIdx] : null;

      if (primary?.journal_title) {
        const jAbbrev = primary.journal_title as string;
        metaInspire.journalAbbreviation = jAbbrev.replace(/\.\s|\./g, ". ");
        if (primary.journal_volume) {
          metaInspire.volume = primary.journal_volume;
        }
        if (primary.artid) {
          metaInspire.pages = primary.artid;
        } else if (primary.page_start) {
          metaInspire.pages = primary.page_start;
          if (primary.page_end) {
            metaInspire.pages = metaInspire.pages + "-" + primary.page_end;
          }
        }
        metaInspire.date = primary.year;
        metaInspire.issue = primary.journal_issue;
      }

      // Process remaining entries (errata, additional publications) - skip the primary
      const errNotes: string[] = [];
      for (let i = 0; i < publicationInfo.length; i++) {
        if (i === primaryIdx) continue; // Skip the primary publication

        const entry = publicationInfo[i];
        // Skip entries that only have pubinfo_freetext (these are summaries, not additional pubs)
        if (!entry.journal_title && entry.pubinfo_freetext) continue;

        if (entry.material === "erratum" && entry.journal_title) {
          // Format journal title consistently (add spaces after dots)
          const jAbbrev = entry.journal_title.replace(/\.\s|\./g, ". ");
          let pagesErr = "";
          if (entry.artid) {
            pagesErr = entry.artid;
          } else if (entry.page_start) {
            pagesErr = entry.page_start;
            if (entry.page_end) {
              pagesErr = pagesErr + "-" + entry.page_end;
            }
          }
          errNotes.push(
            `Erratum: ${jAbbrev} ${entry.journal_volume}, ${pagesErr} (${entry.year})`,
          );
        } else if (entry.journal_title && (entry.page_start || entry.artid)) {
          // Format journal title consistently (add spaces after dots)
          const formattedJournal = entry.journal_title.replace(/\.\s|\./g, ". ");
          let pagesNext = "";
          if (entry.page_start) {
            pagesNext = entry.page_start;
            if (entry.page_end) {
              pagesNext = pagesNext + "-" + entry.page_end;
            }
          } else if (entry.artid) {
            pagesNext = entry.artid;
          }
          errNotes.push(
            `${formattedJournal}  ${entry.journal_volume} (${entry.year}) ${pagesNext}`,
          );
        }
      }
      if (errNotes.length > 0) {
        metaInspire.note = `[${errNotes.join(", ")}]`;
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

    // Fallback: use preprint_date if date is still not set (for unpublished papers)
    if (!metaInspire.date && meta["preprint_date"]) {
      // preprint_date is in format "YYYY-MM-DD", extract year for Zotero
      metaInspire.date = meta["preprint_date"];
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
