// ─────────────────────────────────────────────────────────────────────────────
// Label Matcher Module Index
// FTR-REFACTOR: M-001 - Split labelMatcher.ts into modular components
// ─────────────────────────────────────────────────────────────────────────────

// Export identifier index utilities
export {
  type IdentifierIndexes,
  buildIdentifierIndexes,
  findByArxiv,
  findByDoi,
  findByJournalVol,
  findByJournalVolPage,
} from "./identifierIndex";

// Export author-year matching utilities
export {
  type AuthorYearMatchContext,
  findPreciseMatch,
  matchAuthorYear,
} from "./authorYearMatcher";
