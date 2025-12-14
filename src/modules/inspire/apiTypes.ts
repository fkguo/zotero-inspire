// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE API Response Types
// ─────────────────────────────────────────────────────────────────────────────
// Complete type definitions for INSPIRE HEP API responses.
// See: https://inspirehep.net/help/knowledge-base/inspire-api/

// ─────────────────────────────────────────────────────────────────────────────
// Literature API Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * INSPIRE Literature API search response.
 * Endpoint: GET /api/literature?q=...
 */
export interface InspireLiteratureSearchResponse {
  hits: {
    total: number;
    hits: InspireLiteratureHit[];
  };
  links?: {
    self?: string;
    next?: string;
    prev?: string;
  };
}

/**
 * Single literature record hit from search results.
 */
export interface InspireLiteratureHit {
  id: string;
  created: string;
  updated: string;
  metadata: InspireLiteratureMetadata;
  links?: {
    bibtex?: string;
    latex_us?: string;
    latex_eu?: string;
    json?: string;
  };
}

/**
 * Literature record metadata structure.
 */
export interface InspireLiteratureMetadata {
  control_number: number;
  titles: InspireTitle[];
  authors?: InspireAuthor[];
  author_count?: number;
  publication_info?: InspirePublicationInfo[];
  arxiv_eprints?: InspireArxivEprint[];
  dois?: InspireDOI[];
  citation_count?: number;
  citation_count_without_self_citations?: number;
  abstracts?: InspireAbstract[];
  texkeys?: string[];
  document_type?: string[];
  collaborations?: InspireCollaboration[];
  isbns?: InspireISBN[];
  imprints?: InspireImprint[];
  earliest_date?: string;
  references?: InspireReference[];
  inspire_categories?: InspireCategory[];
  keywords?: InspireKeyword[];
  report_numbers?: InspireReportNumber[];
  external_system_identifiers?: InspireExternalID[];
}

/**
 * Title with optional source.
 */
export interface InspireTitle {
  title: string;
  source?: string;
  subtitle?: string;
}

/**
 * Author information.
 */
export interface InspireAuthor {
  full_name: string;
  first_name?: string;
  last_name?: string;
  ids?: InspireAuthorID[];
  affiliations?: InspireAffiliation[];
  inspire_roles?: string[];
  credit_roles?: string[];
  raw_affiliations?: Array<{ value: string }>;
  record?: InspireRecordRef;
}

/**
 * Author identifier (ORCID, BAI, etc.).
 */
export interface InspireAuthorID {
  schema: "ORCID" | "INSPIRE BAI" | "INSPIRE ID" | string;
  value: string;
}

/**
 * Author affiliation.
 */
export interface InspireAffiliation {
  value: string;
  record?: InspireRecordRef;
}

/**
 * Publication information.
 */
export interface InspirePublicationInfo {
  journal_title?: string;
  journal_volume?: string;
  journal_issue?: string;
  year?: number;
  artid?: string;
  page_start?: string;
  page_end?: string;
  material?: string;
  pubinfo_freetext?: string;
  cnum?: string;
  conference_record?: InspireRecordRef;
  journal_record?: InspireRecordRef;
}

/**
 * arXiv eprint information.
 */
export interface InspireArxivEprint {
  value: string;
  categories?: string[];
}

/**
 * DOI information.
 */
export interface InspireDOI {
  value: string;
  source?: string;
}

/**
 * Abstract with source.
 */
export interface InspireAbstract {
  value: string;
  source?: string;
}

/**
 * Collaboration name.
 */
export interface InspireCollaboration {
  value: string;
  record?: InspireRecordRef;
}

/**
 * ISBN information.
 */
export interface InspireISBN {
  value: string;
  medium?: string;
}

/**
 * Imprint/publisher information.
 */
export interface InspireImprint {
  publisher?: string;
  date?: string;
  place?: string;
}

/**
 * INSPIRE category.
 */
export interface InspireCategory {
  term: string;
  scheme?: string;
  source?: string;
}

/**
 * Keyword.
 */
export interface InspireKeyword {
  value: string;
  schema?: string;
  source?: string;
}

/**
 * Report number.
 */
export interface InspireReportNumber {
  value: string;
  source?: string;
}

/**
 * External system identifier.
 */
export interface InspireExternalID {
  schema: string;
  value: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reference entry within a literature record.
 */
export interface InspireReference {
  reference: InspireReferenceData;
  record?: InspireRecordRef;
  raw_refs?: Array<{ value: string; schema: string }>;
  curated_relation?: boolean;
}

/**
 * Reference data (parsed from raw reference).
 */
export interface InspireReferenceData {
  label?: string;
  authors?: Array<{ full_name: string; inspire_role?: string }>;
  title?: { title: string };
  publication_info?: {
    journal_title?: string;
    journal_volume?: string;
    journal_issue?: string;
    page_start?: string;
    page_end?: string;
    artid?: string;
    year?: number;
  };
  arxiv_eprint?: string;
  dois?: string[];
  collaborations?: string[];
  misc?: string[];
  imprint?: { publisher?: string };
  isbn?: string;
  persistent_identifiers?: Array<{ value: string; schema: string }>;
}

/**
 * Record reference (link to another INSPIRE record).
 */
export interface InspireRecordRef {
  $ref: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CrossRef API Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CrossRef API works response.
 * Endpoint: GET https://api.crossref.org/works/{doi}
 */
export interface CrossRefWorksResponse {
  status: string;
  "message-type": string;
  "message-version": string;
  message: CrossRefWork;
}

/**
 * CrossRef work metadata.
 */
export interface CrossRefWork {
  DOI: string;
  title?: string[];
  author?: CrossRefAuthor[];
  "is-referenced-by-count"?: number;
  "references-count"?: number;
  published?: CrossRefDate;
  "published-print"?: CrossRefDate;
  "published-online"?: CrossRefDate;
  type?: string;
  container_title?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  abstract?: string;
}

/**
 * CrossRef author.
 */
export interface CrossRefAuthor {
  given?: string;
  family?: string;
  name?: string;
  ORCID?: string;
  affiliation?: Array<{ name: string }>;
}

/**
 * CrossRef date parts.
 */
export interface CrossRefDate {
  "date-parts": number[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type guard for INSPIRE Literature search response.
 */
export function isInspireLiteratureSearchResponse(
  obj: unknown,
): obj is InspireLiteratureSearchResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "hits" in obj &&
    typeof (obj as InspireLiteratureSearchResponse).hits?.total === "number" &&
    Array.isArray((obj as InspireLiteratureSearchResponse).hits?.hits)
  );
}

/**
 * Type guard for INSPIRE Literature hit.
 */
export function isInspireLiteratureHit(
  obj: unknown,
): obj is InspireLiteratureHit {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    "metadata" in obj &&
    typeof (obj as InspireLiteratureHit).metadata?.control_number === "number"
  );
}

/**
 * Type guard for CrossRef works response.
 */
export function isCrossRefWorksResponse(
  obj: unknown,
): obj is CrossRefWorksResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "status" in obj &&
    "message" in obj &&
    typeof (obj as CrossRefWorksResponse).message?.DOI === "string"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract recid from INSPIRE record $ref URL.
 * Example: "https://inspirehep.net/api/literature/123456" -> "123456"
 */
export function extractRecidFromRef(
  ref: InspireRecordRef | undefined,
): string | undefined {
  if (!ref?.$ref) return undefined;
  const match = ref.$ref.match(/\/literature\/(\d+)$/);
  return match?.[1];
}

/**
 * Get primary title from titles array.
 */
export function getPrimaryTitle(
  titles: InspireTitle[] | undefined,
): string | undefined {
  if (!titles?.length) return undefined;
  // Prefer non-arXiv source title
  const nonArxiv = titles.find((t) => t.source !== "arXiv");
  return (nonArxiv ?? titles[0]).title;
}

/**
 * Get primary arXiv ID from eprints array.
 */
export function getPrimaryArxivId(
  eprints: InspireArxivEprint[] | undefined,
): string | undefined {
  return eprints?.[0]?.value;
}

/**
 * Get primary DOI from DOIs array.
 */
export function getPrimaryDoi(
  dois: InspireDOI[] | undefined,
): string | undefined {
  return dois?.[0]?.value;
}

/**
 * Get primary abstract text.
 */
export function getPrimaryAbstract(
  abstracts: InspireAbstract[] | undefined,
): string | undefined {
  return abstracts?.[0]?.value;
}
