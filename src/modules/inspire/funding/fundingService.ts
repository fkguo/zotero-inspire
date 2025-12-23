import { extractAcknowledgmentSection } from "./acknowledgmentExtractor";
import { extractFundingInfo } from "./fundingExtractor";
import { FundingResult, FundingInfo } from "./types";
import { extractArxivIdFromItem } from "../apiUtils";
import { LRUCache } from "../utils";
import { getPref } from "../../../utils/prefs";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum number of items to cache in memory */
const FUNDING_CACHE_SIZE = 100;

/** Timeout for PDFWorker text extraction (ms) */
const PDF_WORKER_TIMEOUT_MS = 15000;

/** Maximum pages for PDFWorker extraction */
const PDF_WORKER_MAX_PAGES = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

// Cache ALL funding results by item ID (unfiltered, session-scoped)
// Filtering is applied dynamically based on current preference
const fundingCache = new LRUCache<number, FundingResult>(FUNDING_CACHE_SIZE);

/**
 * Clear funding cache for a specific item (called when item is deleted)
 */
export function clearFundingCache(itemId: number): void {
  fundingCache.delete(itemId);
}

/**
 * Get funding info for a Zotero item (extracted from PDF acknowledgments)
 */
export async function getFundingForItem(
  item: Zotero.Item,
): Promise<FundingResult> {
  // Check cache first (contains ALL funding, unfiltered)
  let cached = fundingCache.get(item.id);

  if (!cached) {
    // Extract funding info and cache it
    cached = await extractAndCacheFunding(item);
  }

  // Apply filtering based on current preference (dynamic, not cached)
  const chinaOnly = getPref("funding_china_only") === true;
  const filteredFunding: FundingInfo[] = chinaOnly
    ? cached.funding.filter((f) => f.category === "china")
    : cached.funding;

  return {
    ...cached,
    funding: filteredFunding,
  };
}

/**
 * Extract funding info and store in cache (unfiltered)
 */
async function extractAndCacheFunding(item: Zotero.Item): Promise<FundingResult> {
  // Handle PDF attachments: get metadata from parent, but use PDF directly for text
  let metadataItem = item;
  let pdfAttachment: Zotero.Item | null = null;

  if (item.isPDFAttachment()) {
    // Use PDF directly for text extraction
    pdfAttachment = item;
    // Get parent item for metadata (title, arxiv, doi)
    const parentID = item.parentItemID;
    if (parentID) {
      const parent = await Zotero.Items.getAsync(parentID);
      if (parent) {
        metadataItem = parent;
      }
    }
  } else if (item.isRegularItem()) {
    // Get PDF attachment for regular items
    pdfAttachment = await getPdfAttachment(item);
  }

  const title = metadataItem.getField("title") as string || "";
  const arxivId = extractArxivIdFromItem(metadataItem);
  const doi = metadataItem.getField("DOI") as string || "";

  if (!pdfAttachment) {
    const result: FundingResult = { title, arxivId, doi, funding: [], source: "none" };
    fundingCache.set(item.id, result);
    return result;
  }

  // 2. Read PDF full text (prioritize cache)
  const pdfText = await getPdfFullText(pdfAttachment);
  if (!pdfText) {
    const result: FundingResult = { title, arxivId, doi, funding: [], source: "none" };
    fundingCache.set(item.id, result);
    return result;
  }

  // 3. Locate acknowledgment section
  const ackSection = extractAcknowledgmentSection(pdfText);

  // 4. Extract ALL funding info (no filtering here)
  const textToAnalyze = ackSection ? ackSection.text : pdfText;
  const funding = extractFundingInfo(textToAnalyze);

  const result: FundingResult = { title, arxivId, doi, funding, source: "pdf" };
  fundingCache.set(item.id, result);
  return result;
}

/**
 * Read PDF full text
 * Prioritize Zotero fulltext cache, fallback to PDFWorker with timeout
 */
async function getPdfFullText(attachment: Zotero.Item): Promise<string | null> {
  // Try reading from cache
  const cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
  if (cacheFile && (await IOUtils.exists(cacheFile.path))) {
    try {
      return await IOUtils.readUTF8(cacheFile.path);
    } catch (e) {
      ztoolkit.log(`[Funding] Failed to read cache: ${e}`);
    }
  }

  // Fallback to PDFWorker with timeout
  // Note: Zotero.PDFWorker.getFullText does not support AbortController.
  // Using Promise.race with timeout as the cancellation mechanism.
  try {
    const workerPromise = Zotero.PDFWorker.getFullText(attachment.id, PDF_WORKER_MAX_PAGES);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), PDF_WORKER_TIMEOUT_MS),
    );

    const result = await Promise.race([workerPromise, timeoutPromise]);
    return result?.text || null;
  } catch (e) {
    ztoolkit.log(`[Funding] PDFWorker failed: ${e}`);
    return null;
  }
}

/**
 * Get PDF attachment for an item
 * Priority: 1) Best attachment (user's preferred) 2) First PDF with fulltext cache 3) First PDF
 */
async function getPdfAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  if (item.isPDFAttachment()) {
    return item;
  }

  if (item.isRegularItem()) {
    // Try to get the best attachment first (the one Zotero opens by default)
    try {
      const bestAttachment = await item.getBestAttachment();
      if (bestAttachment && bestAttachment.isPDFAttachment()) {
        return bestAttachment;
      }
    } catch (e) {
      // getBestAttachment may not be available or may fail
      ztoolkit.log(`[Funding] getBestAttachment failed: ${e}`);
    }

    // Fallback: find all PDF attachments and prefer one with fulltext cache
    const attachmentIDs = item.getAttachments();
    const pdfAttachments: Zotero.Item[] = [];

    for (const id of attachmentIDs) {
      const attachment = await Zotero.Items.getAsync(id);
      if (attachment.isPDFAttachment()) {
        pdfAttachments.push(attachment);
      }
    }

    if (pdfAttachments.length === 0) {
      return null;
    }

    // Prefer PDF with existing fulltext cache
    for (const pdf of pdfAttachments) {
      const cacheFile = Zotero.Fulltext.getItemCacheFile(pdf);
      if (cacheFile && (await IOUtils.exists(cacheFile.path))) {
        return pdf;
      }
    }

    // Return first PDF as last resort
    return pdfAttachments[0];
  }

  return null;
}
