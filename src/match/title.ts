/**
 * Title matching: Zotero-style normalization + Unicode NFKD + token_set_ratio
 */

// ── Unicode helpers ──────────────────────────────────────────────────────────

/** Fullwidth → ASCII, then NFKD decompose, strip combining marks, lowercase. */
function normalizeUnicode(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase();
}

// ── Title matching ───────────────────────────────────────────────────────────

/**
 * Zotero-style title normalization:
 * 1. Unicode NFKD + strip diacritics + lowercase
 * 2. Map punctuation to spaces (hyphens, colons, dashes, quotes, etc.)
 * 3. Collapse whitespace
 */
export function normalizeTitle(title: string): string {
  return normalizeUnicode(title)
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D—–\-:;,!?()[\]{}'"""''«»›‹/\\]/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize a normalized title into sorted unique tokens. */
function titleTokens(normalized: string): Set<string> {
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

/**
 * Token set ratio: compares two strings by their token overlap.
 * Returns 0–1 where 1 = identical token sets.
 * Based on the fuzzball/FuzzyWuzzy token_set_ratio algorithm.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = titleTokens(normalizeTitle(a));
  const tb = titleTokens(normalizeTitle(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;

  const intersection = [...ta].filter((t) => tb.has(t));
  if (intersection.length === 0) return 0;

  // Reconstruct "sorted intersection" and "sorted difference" strings
  const _sortedA = [...ta].sort().join(" ");
  const _sortedB = [...tb].sort().join(" ");
  const common = intersection.sort().join(" ");
  const diffA = [...ta]
    .filter((t) => !tb.has(t))
    .sort()
    .join(" ");
  const diffB = [...tb]
    .filter((t) => !ta.has(t))
    .sort()
    .join(" ");

  // Three combined strings: common+diffA, common+diffB, common+common
  const combinedA = diffA ? `${common} ${diffA}` : common;
  const combinedB = diffB ? `${common} ${diffB}` : common;

  const r1 = ratio(combinedA, combinedB);
  const r2 = ratio(combinedA, common);
  const r3 = ratio(combinedB, common);

  return Math.max(r1, r2, r3);
}

/** Simple character-level ratio between two strings. */
function ratio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return (maxLen - dist) / maxLen;
}

/** Levenshtein edit distance (standard DP, O(nm)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Uint32Array(b.length + 1);
  const curr = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev.set(curr);
  }
  return curr[b.length]!;
}

export type TitleMatchLevel = "exact" | "fuzzy_match" | "mismatch";

export interface TitleMatchResult {
  level: TitleMatchLevel;
  score: number; // 0–1
  normalizedLocal: string;
  normalizedSource: string;
}

/**
 * Compare a local title against an authoritative source title.
 * Returns match level and score.
 */
export function compareTitles(local: string, source: string): TitleMatchResult {
  const nl = normalizeTitle(local);
  const ns = normalizeTitle(source);

  if (nl === ns) {
    return { level: "exact", score: 1, normalizedLocal: nl, normalizedSource: ns };
  }

  const score = tokenSetRatio(local, source);
  const level: TitleMatchLevel = score >= 0.85 ? "fuzzy_match" : "mismatch";
  return { level, score, normalizedLocal: nl, normalizedSource: ns };
}
