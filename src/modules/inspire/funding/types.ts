export interface FunderPattern {
  id: string; // Short name, e.g., "NSFC"
  name: string; // Full name
  aliases: string[]; // Aliases (English and Chinese)
  patterns: RegExp[]; // Grant number regex patterns
  priority: number; // Match priority (higher is better)
  category: "china" | "us" | "eu" | "asia" | "intl";
  hasGrantNumber?: boolean; // Whether it has a standardized grant number format (default true)
  nextPattern?: RegExp; // Pattern to match subsequent grant numbers in a list (e.g. comma separated)
}

export interface AcknowledgmentSection {
  startIndex: number;
  endIndex: number;
  text: string;
  language: "en" | "zh" | "mixed";
  source: "acknowledgments" | "funding" | "footnote" | "full_text";
}

export interface FundingInfo {
  funderId: string; // Standard short name, e.g., "NSFC"
  funderName: string; // Full English name
  grantNumber: string; // Grant number
  confidence: number; // Confidence 0-1
  rawMatch: string; // Raw matched text
  position: number; // Position in text
  category: string; // Category: china/us/eu/asia/intl
}

export interface FundingResult {
  title: string;
  arxivId?: string;
  doi?: string;
  funding: FundingInfo[];
  source: "pdf" | "none";
}

/**
 * Internal type for candidate matches during extraction.
 * Used by fundingExtractor to track potential matches before deduplication.
 */
export interface CandidateMatch {
  funder: FunderPattern;
  grantNumber: string;
  rawMatch: string;
  index: number;
  length: number;
  confidence: number;
}