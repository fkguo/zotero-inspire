import { FUNDER_PATTERNS } from "./fundingPatterns";
import { FundingInfo, FunderPattern, CandidateMatch } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum text length to process (prevent ReDoS on very long inputs) */
const MAX_TEXT_LENGTH = 100000;

/** Distance threshold for DFG dual identifier merging (accounts for long DFG name patterns) */
const DFG_DEDUP_DISTANCE = 120;

export function extractFundingInfo(text: string): FundingInfo[] {
  // Limit input text length to prevent ReDoS attacks on very long inputs
  // Acknowledgment sections are typically < 10KB, so 100KB is very generous
  if (text.length > MAX_TEXT_LENGTH) {
    ztoolkit.log(
      `[Funding] Text too long (${text.length} chars), truncating to ${MAX_TEXT_LENGTH}`,
    );
    text = text.slice(0, MAX_TEXT_LENGTH);
  }

  // Normalize full-width characters first
  let normalizedText = normalizeFullWidthChars(text);

  // Remove page headers/footers to handle cross-page text
  // e.g. "123", "Eur. Phys. J. C (2024) 84:191 Page 11 of 13 191"
  normalizedText = normalizedText.replace(/^\s*\d+\s*$/gm, " "); // Standalone numbers (page numbers)
  normalizedText = normalizedText.replace(/.*Page \d+ of \d+.*/gi, " "); // Page X of Y headers
  // Remove common journal headers if they appear in the middle of text
  // Use a more specific pattern to avoid matching body text
  normalizedText = normalizedText.replace(
    /Eur\.\s*Phys\.\s*J\.\s*C[^\n]*/gi,
    " ",
  );

  // Replace newlines with spaces to simplify regex matching across lines
  normalizedText = normalizedText.replace(/[\r\n]+/g, " ");

  const results: FundingInfo[] = [];
  const seenGrants = new Set<string>();

  // Use the original order of FUNDER_PATTERNS to respect priority,
  // but we need to collect all matches first and then sort by position
  // to respect the order in the text.

  const candidates: CandidateMatch[] = [];

  for (const funder of FUNDER_PATTERNS) {
    for (const pattern of funder.patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(normalizedText)) !== null) {
        const grantNumber = match[1];
        // Skip invalid matches
        if (!grantNumber && funder.hasGrantNumber !== false) continue;

        const finalGrantNumber = grantNumber ? grantNumber.trim() : "";

        // Validate
        if (
          funder.hasGrantNumber === false ||
          validateGrantNumber(funder.id, finalGrantNumber)
        ) {
          candidates.push({
            funder,
            grantNumber: finalGrantNumber,
            rawMatch: match[0],
            index: match.index,
            length: match[0].length,
            confidence: calculateConfidence(funder, match[0], normalizedText),
          });

          // Look for subsequent matches (nextPattern)
          if (funder.nextPattern && funder.hasGrantNumber !== false) {
            let currentLastIndex = regex.lastIndex;
            let nextMatch: RegExpExecArray | null;
            while (true) {
              const remainingText = normalizedText.slice(currentLastIndex);
              const nextRegex = new RegExp(
                funder.nextPattern.source,
                funder.nextPattern.flags,
              );
              nextMatch = nextRegex.exec(remainingText);

              if (!nextMatch) break;
              const nextGrant = nextMatch[1];
              if (!nextGrant) break;

              const nextGrantTrimmed = nextGrant.trim();
              if (validateGrantNumber(funder.id, nextGrantTrimmed)) {
                candidates.push({
                  funder,
                  grantNumber: nextGrantTrimmed,
                  rawMatch: nextMatch[0],
                  index: currentLastIndex + nextMatch.index,
                  length: nextMatch[0].length,
                  confidence: calculateConfidence(
                    funder,
                    nextMatch[0],
                    normalizedText,
                  ),
                });
              }
              currentLastIndex += nextMatch.index + nextMatch[0].length;
            }
          }
        }
      }
    }
  }

  // Sort candidates by position
  candidates.sort((a, b) => a.index - b.index);

  // Filter overlapping matches
  const acceptedMatches: CandidateMatch[] = [];

  for (const candidate of candidates) {
    // Check for overlap with already accepted matches
    const overlap = acceptedMatches.find(
      (m) =>
        candidate.index < m.index + m.length &&
        candidate.index + candidate.length > m.index,
    );

    if (overlap) {
      // If overlap, keep the one with higher priority
      if (candidate.funder.priority > overlap.funder.priority) {
        // Replace the lower priority one
        const idx = acceptedMatches.indexOf(overlap);
        acceptedMatches[idx] = candidate;
      }
      // Else ignore this lower priority candidate
    } else {
      acceptedMatches.push(candidate);
    }
  }

  // Final pass to build results and deduplicate
  // Re-sort to ensure order
  acceptedMatches.sort((a, b) => a.index - b.index);

  for (const match of acceptedMatches) {
    const key = `${match.funder.id}:${match.grantNumber}`;
    if (!seenGrants.has(key)) {
      seenGrants.add(key);
      results.push({
        funderId: match.funder.id,
        funderName: match.funder.name,
        grantNumber: normalizeGrantNumber(match.funder.id, match.grantNumber),
        confidence: match.confidence,
        rawMatch: match.rawMatch,
        position: match.index,
        category: match.funder.category,
      });
    }
  }

  // DFG deduplication: When a 9-digit numeric ID and SFB/TRR/CRC number appear close together
  // (e.g., "279384907 — SFB 1245"), they refer to the same project.
  // Keep only the numeric ID (preferred for administrative purposes).
  // Strategy can be changed by modifying this function.
  // See: CLAUDE.md or plugin-patterns.md for documentation.
  const deduplicatedResults = deduplicateDFGGrants(results);

  return deduplicatedResults;
}

/**
 * DFG Deduplication: Merge duplicate DFG grants when numeric ID and SFB/TRR/CRC
 * number appear close together (same project, different identifiers).
 *
 * Strategy: Keep numeric ID as primary, append SFB/TRR/CRC in brackets.
 * Example: "279384907 [SFB 1245]"
 *
 * To change strategy (e.g., keep SFB as primary):
 * - Swap the merge logic to use SFB/TRR/CRC as primary and append numeric ID
 */
function deduplicateDFGGrants(results: FundingInfo[]): FundingInfo[] {
  // Find all DFG grants
  const dfgGrants = results.filter((r) => r.funderId === "DFG");
  if (dfgGrants.length < 2) return results;

  // Identify numeric IDs (9 digits) and SFB/TRR/CRC numbers
  const numericIds = dfgGrants.filter((r) => /^\d{9}$/.test(r.grantNumber));
  const sfbNumbers = dfgGrants.filter((r) =>
    /^(?:SFB|TRR|CRC)\s?\d{2,4}$/i.test(r.grantNumber),
  );

  // Find pairs of numeric ID and SFB that are close together
  const sfbToRemove = new Set<string>();
  const mergeMap = new Map<string, string>(); // numericId position -> SFB name

  for (const sfb of sfbNumbers) {
    for (const numId of numericIds) {
      const distance = Math.abs(sfb.position - numId.position);
      if (distance < DFG_DEDUP_DISTANCE) {
        // Same project - merge SFB into numeric ID
        sfbToRemove.add(`${sfb.grantNumber}:${sfb.position}`);
        mergeMap.set(`${numId.grantNumber}:${numId.position}`, sfb.grantNumber);
        break;
      }
    }
  }

  // Process results: merge or filter
  return results
    .filter((r) => {
      if (r.funderId !== "DFG") return true;
      const key = `${r.grantNumber}:${r.position}`;
      return !sfbToRemove.has(key);
    })
    .map((r) => {
      if (r.funderId !== "DFG") return r;
      const key = `${r.grantNumber}:${r.position}`;
      const sfbName = mergeMap.get(key);
      if (sfbName) {
        // Append SFB in brackets: "279384907 [SFB 1245]"
        return { ...r, grantNumber: `${r.grantNumber} [${sfbName}]` };
      }
      return r;
    });
}

/**
 * Normalize full-width characters (e.g., １２３ -> 123)
 */
function normalizeFullWidthChars(text: string): string {
  return text.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/**
 * Validate grant number format
 */
function validateGrantNumber(funderId: string, grantNumber: string): boolean {
  if (!grantNumber || grantNumber.length < 3) return false; // Relaxed length check

  switch (funderId) {
    case "NSFC": {
      // First digit 1-8 (Dept), U (Joint), 9 (Major)
      // Length: 8-11 digits
      const firstChar = grantNumber[0];
      const len = grantNumber.length;
      if (len < 8 || len > 11) return false;
      if (firstChar === "U" || firstChar === "9") return true;
      const dept = parseInt(firstChar, 10);
      return dept >= 1 && dept <= 8;
    }

    case "MoST": {
      // Year 2016 - Current Year + 1
      const year = parseInt(grantNumber.slice(0, 4), 10);
      const currentYear = new Date().getFullYear();
      return year >= 2016 && year <= currentYear + 1;
    }

    case "MoST-973":
    case "MoST-863": {
      // Year 2001-2017
      const year = parseInt(grantNumber.slice(0, 4), 10);
      return year >= 2001 && year <= 2017;
    }

    case "DOE": {
      // DE- prefix format (most common)
      if (grantNumber.startsWith("DE-")) return true;
      // QuantISED format: 89243024CSC000002 (8 digits + 3 letters + 6 digits)
      if (/^\d{8}[A-Z]{3}\d{6}$/.test(grantNumber)) return true;
      // Legacy office code format (SC, EE, etc.)
      const office = grantNumber.slice(0, 2);
      const validOffices = ["SC", "EE", "FE", "NE", "OE", "EM", "AR", "CE"];
      return validOffices.includes(office);
    }

    case "NSF": {
      // Dept code validation
      const dept = grantNumber.replace(/-/g, "").slice(0, 3);
      const validDepts = [
        "PHY",
        "AST",
        "DMR",
        "CHE",
        "DMS",
        "MPS",
        "ENG",
        "BIO",
      ];
      return (
        validDepts.some((d) => dept.startsWith(d)) ||
        /^[A-Z]{3,4}\d{7}$/.test(grantNumber.replace(/-/g, ""))
      );
    }

    case "ERC": {
      // 6-9 digits
      return /^\d{6,9}$/.test(grantNumber);
    }

    default:
      return true;
  }
}

/**
 * Normalize grant number format
 */
function normalizeGrantNumber(funderId: string, grantNumber: string): string {
  switch (funderId) {
    case "NSF":
      // Ensure hyphen: PHY2310429 -> PHY-2310429
      if (/^[A-Z]{3,4}\d{7}$/.test(grantNumber)) {
        const letters = grantNumber.match(/^[A-Z]+/)![0];
        const numbers = grantNumber.slice(letters.length);
        return `${letters}-${numbers}`;
      }
      return grantNumber;

    case "DOE":
      // Uppercase
      return grantNumber.toUpperCase();

    case "JuntaAndalucia":
      // P18-FR 5057 -> P18-FR-5057
      // P18-FR- 5057 -> P18-FR-5057
      return grantNumber.replace(/\s+/g, "-").replace(/-+/g, "-");

    default:
      return grantNumber;
  }
}

/**
 * Calculate confidence score
 */
function calculateConfidence(
  funder: FunderPattern,
  rawMatch: string,
  fullText: string,
): number {
  let confidence = 0.6; // Base confidence

  // Check if alias is present
  const matchLower = rawMatch.toLowerCase();
  const hasAlias = funder.aliases.some((alias: string) =>
    matchLower.includes(alias.toLowerCase()),
  );
  if (hasAlias) confidence += 0.25;

  // Check context keywords
  const contextKeywords = [
    /grant/i,
    /supported/i,
    /funded/i,
    /资助/,
    /acknowledge/i,
    /致谢/,
    /project/i,
    /项目/,
  ];
  const hasContextKeyword = contextKeywords.some((kw) => kw.test(rawMatch));
  if (hasContextKeyword) confidence += 0.1;

  // Check if in Acknowledgments section
  const ackIndex = fullText.search(/acknowledgm?ents?|致\s*谢/i);
  const refIndex = fullText.search(/references?|参考文献/i);
  if (ackIndex >= 0 && refIndex >= 0) {
    const matchIndex = fullText.indexOf(rawMatch);
    if (matchIndex > ackIndex && matchIndex < refIndex) {
      confidence += 0.05;
    }
  }

  return Math.min(confidence, 1.0);
}