import type { InspireReferenceEntry } from "./types";

const PDG_RPP_TITLE_REGEX = /\breview of particle physics\b/i;
const REVIEW_DOC_TYPE_REGEX = /\breview\b/i;

const REVIEW_JOURNAL_KEY_SUBSTRINGS = [
  // Rev. Mod. Phys.
  "rmp",
  "revmodphys",
  "reviewsofmodernphysics",
  // Phys. Rept.
  "physrep",
  "physrept",
  "physicsreports",
  // Prog. Part. Nucl. Phys.
  "ppnp",
  "progpartnuclphys",
  "progressinparticleandnuclearphysics",
  // Rep. Prog. Phys.
  "rpp",
  "repprogphys",
  "reptprogphys",
  "reportsonprogressinphysics",
];

const ANNUAL_REVIEW_KEY_PREFIXES = ["annualreview", "annurev", "annrev"];

function normalizeJournalKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function collectJournalCandidates(publicationInfo: unknown): string[] {
  const titles: string[] = [];

  const pushIfString = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      titles.push(value);
    }
  };

  const collectFromObject = (info: Record<string, unknown>) => {
    pushIfString(info.journal_title);
    pushIfString(info.journal_title_abbrev);
    // Fallbacks for non-INSPIRE shapes (defensive)
    pushIfString(info.journalTitle);
    pushIfString(info.journalAbbrev);
  };

  if (!publicationInfo) {
    return titles;
  }
  if (Array.isArray(publicationInfo)) {
    for (const item of publicationInfo) {
      if (item && typeof item === "object") {
        collectFromObject(item as Record<string, unknown>);
      }
    }
    return titles;
  }
  if (typeof publicationInfo === "object") {
    collectFromObject(publicationInfo as Record<string, unknown>);
  }
  return titles;
}

export function isPdgReviewOfParticlePhysicsTitle(title: unknown): boolean {
  if (typeof title !== "string") return false;
  return PDG_RPP_TITLE_REGEX.test(title);
}

export function isReviewDocumentType(documentType: unknown): boolean {
  if (!Array.isArray(documentType)) return false;
  return documentType.some(
    (t) => typeof t === "string" && REVIEW_DOC_TYPE_REGEX.test(t),
  );
}

export function isReviewJournal(publicationInfo: unknown): boolean {
  for (const candidate of collectJournalCandidates(publicationInfo)) {
    const key = normalizeJournalKey(candidate);
    if (!key) continue;

    if (ANNUAL_REVIEW_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      return true;
    }
    if (REVIEW_JOURNAL_KEY_SUBSTRINGS.some((s) => key.includes(s))) {
      return true;
    }
  }
  return false;
}

// Alias for callers working with raw INSPIRE metadata shapes (e.g. `publication_info`)
export function isReviewJournalPublicationInfo(publicationInfo: unknown): boolean {
  return isReviewJournal(publicationInfo);
}

export function isReviewArticleEntry(
  entry: Pick<InspireReferenceEntry, "documentType" | "publicationInfo">,
): boolean {
  return isReviewDocumentType(entry.documentType) || isReviewJournal(entry.publicationInfo);
}
