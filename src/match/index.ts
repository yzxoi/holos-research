/**
 * Robust comparison utilities for academic metadata verification.
 *
 * Title matching: Zotero-style normalization + Unicode NFKD + token_set_ratio
 * Author matching: 4-layer rule system (normalize → compatible → Hungarian → grade)
 */

// Hungarian algorithm
export { hungarian } from "./hungarian";
// Author list matching (top-level orchestrator)
export type { AuthorConflict, AuthorMatchResult } from "./name";
// Author name parsing & compatibility
export {
  type FirstNameResult,
  type LastNameResult,
  type MiddleResult,
  matchAuthorLists,
  type NameCompatibility,
  namesCompatible,
  type ParsedName,
  parseName,
} from "./name";
// Title matching
export {
  compareTitles,
  levenshtein,
  normalizeTitle,
  type TitleMatchLevel,
  type TitleMatchResult,
  tokenSetRatio,
} from "./title";
