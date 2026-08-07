/**
 * Author name parsing and compatibility comparison.
 *
 * Parsing: parseName, isAmbiguousEastAsian
 * Compatibility: namesCompatible, compareNamePair, compareLastName, compareFirstName,
 *                isInitialOf, compareMiddles
 */

import { hungarian } from "./hungarian";
import { levenshtein } from "./title";

// ── Author name parsing ──────────────────────────────────────────────────────

export interface ParsedName {
  first: string;
  middle: string[];
  last: string;
  suffix: string;
  raw: string;
  /** True if heuristically detected as likely East Asian name */
  ambiguousOrder: boolean;
}

const EAST_ASIAN_SURNAMES = new Set([
  "wang",
  "li",
  "zhang",
  "liu",
  "chen",
  "yang",
  "huang",
  "zhao",
  "wu",
  "zhou",
  "xu",
  "sun",
  "ma",
  "zhu",
  "hu",
  "guo",
  "lin",
  "he",
  "gao",
  "luo",
  "zheng",
  "liang",
  "xie",
  "tang",
  "han",
  "cao",
  "deng",
  "feng",
  "wei",
  "cheng",
  "peng",
  "zeng",
  "xiao",
  "tian",
  "dong",
  "pan",
  "yuan",
  "jiang",
  "cai",
  "yu",
  "choi",
  "kim",
  "lee",
  "park",
  "jung",
  "kang",
  "cho",
  "yamamoto",
  "tanaka",
  "suzuki",
  "sato",
  "watanabe",
  "ito",
  "nakamura",
  "nguyen",
  "tran",
  "le",
  "pham",
  "vo",
]);

/**
 * Parse a full name string into structured parts.
 * Handles "First Last", "First Middle Last", "Last, First Middle", suffixes.
 */
export function parseName(raw: string): ParsedName {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  let first = "";
  let middle: string[] = [];
  let last = "";
  let suffix = "";

  // "Last, First Middle" format
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    const lastPart = parts[0]!.trim();
    const rest = parts.slice(1).join(",").trim().split(/\s+/);
    last = lastPart;
    if (rest.length > 0) first = rest[0]!;
    if (rest.length > 1) middle = rest.slice(1);
  } else {
    const tokens = cleaned.split(/\s+/);
    const suffixes = ["jr", "sr", "ii", "iii", "iv", "v", "phd", "md"];
    const suffixIdx = tokens.findIndex((t) => suffixes.includes(t.toLowerCase().replace(".", "")));

    const nameTokens = suffixIdx >= 0 ? tokens.slice(0, suffixIdx) : tokens;
    suffix = suffixIdx >= 0 ? tokens.slice(suffixIdx).join(" ") : "";

    if (nameTokens.length === 1) {
      last = nameTokens[0]!;
    } else if (nameTokens.length === 2) {
      first = nameTokens[0]!;
      last = nameTokens[1]!;
    } else {
      first = nameTokens[0]!;
      middle = nameTokens.slice(1, -1);
      last = nameTokens[nameTokens.length - 1]!;
    }
  }

  const ambiguousOrder = isAmbiguousEastAsian(first, last);

  return {
    first: first.toLowerCase().replace(/\.$/, ""),
    middle: middle.map((m) => m.toLowerCase().replace(/\.$/, "")),
    last: last.toLowerCase().replace(/\.$/, ""),
    suffix: suffix.toLowerCase(),
    raw: cleaned,
    ambiguousOrder,
  };
}

function isAmbiguousEastAsian(first: string, last: string): boolean {
  const f = first.toLowerCase();
  const l = last.toLowerCase();
  if (EAST_ASIAN_SURNAMES.has(f) && !EAST_ASIAN_SURNAMES.has(l)) return true;
  if (EAST_ASIAN_SURNAMES.has(l) && !EAST_ASIAN_SURNAMES.has(f)) return false; // normal order
  if (EAST_ASIAN_SURNAMES.has(f) && EAST_ASIAN_SURNAMES.has(l)) return true;
  return false;
}

// ── Author name compatibility ────────────────────────────────────────────────

export type NameCompatibility = "exact" | "compatible" | "incompatible" | "ambiguous";

/**
 * Compare two parsed names for compatibility.
 * Handles initials, hyphenated names, East Asian ambiguous order.
 */
export function namesCompatible(a: ParsedName, b: ParsedName): NameCompatibility {
  const pairs =
    a.ambiguousOrder || b.ambiguousOrder
      ? [
          { first: a.first, last: a.last },
          { first: a.last, last: a.first },
        ]
      : [{ first: a.first, last: a.last }];

  const bPairs = b.ambiguousOrder
    ? [
        { first: b.first, last: b.last },
        { first: b.last, last: b.first },
      ]
    : [{ first: b.first, last: b.last }];

  let bestResult: NameCompatibility = "incompatible";
  let hasAmbiguous = false;

  for (const ap of pairs) {
    for (const bp of bPairs) {
      const result = compareNamePair(ap, bp, a.middle, b.middle);
      if (result === "exact") return "exact";
      if (result === "compatible") bestResult = "compatible";
      if (result === "ambiguous") hasAmbiguous = true;
    }
  }

  if (bestResult === "compatible") return "compatible";
  if (hasAmbiguous) return "ambiguous";
  return bestResult;
}

function compareNamePair(
  a: { first: string; last: string },
  b: { first: string; last: string },
  middleA: string[],
  middleB: string[],
): NameCompatibility {
  // Last name comparison
  const lastCmp = compareLastName(a.last, b.last);
  if (lastCmp === "different") return "incompatible";

  // First name comparison
  const firstCmp = compareFirstName(a.first, b.first);
  if (firstCmp === "conflict") return "incompatible";

  // Middle name comparison (only if both have middles)
  const middleCmp = compareMiddles(middleA, middleB);

  // Combine
  if (lastCmp === "same" && firstCmp === "match" && middleCmp !== "conflict") {
    return "exact";
  }
  if (lastCmp === "variant" || firstCmp === "compatible" || middleCmp === "compatible") {
    return "compatible";
  }
  return "ambiguous";
}

export type LastNameResult = "same" | "variant" | "different";

function compareLastName(a: string, b: string): LastNameResult {
  if (a === b) return "same";
  const na = a.replace(/-/g, "");
  const nb = b.replace(/-/g, "");
  if (na === nb) return "variant";
  if (levenshtein(na, nb) <= 1) return "variant";
  return "different";
}

export type FirstNameResult = "match" | "compatible" | "conflict";

function compareFirstName(a: string, b: string): FirstNameResult {
  if (a === b) return "match";
  // Initial compatibility: "a" ≈ "adam"
  if (isInitialOf(a, b) || isInitialOf(b, a)) return "compatible";
  // Hyphen/spacing variants
  const na = a.replace(/-/g, "");
  const nb = b.replace(/-/g, "");
  if (na === nb) return "compatible";
  return "conflict";
}

function isInitialOf(initial: string, full: string): boolean {
  if (initial.length !== 1) return false;
  return full.startsWith(initial);
}

export type MiddleResult = "match" | "compatible" | "conflict" | "unavailable";

function compareMiddles(a: string[], b: string[]): MiddleResult {
  if (a.length === 0 && b.length === 0) return "match";
  if (a.length === 0 || b.length === 0) return "unavailable";

  // All present initials must be compatible
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    const cmp = compareFirstName(a[i]!, b[i]!);
    if (cmp === "conflict") return "conflict";
  }
  return "compatible";
}

// ── Author list matching (Hungarian algorithm) ──────────────────────────────

export interface AuthorMatchResult {
  score: number; // 0–1 overall match
  pairs: Array<{ local: number; source: number; compat: NameCompatibility }>;
  unmatchedLocal: number[];
  unmatchedSource: number[];
  conflicts: AuthorConflict[];
}

export interface AuthorConflict {
  type: "name_mismatch" | "missing_author" | "extra_author" | "order_shift";
  severity: "error" | "warning" | "info";
  description: string;
}

/**
 * Match two author lists using optimal assignment (Hungarian algorithm).
 * Returns matched pairs, unmatched indices, and detected conflicts.
 */
export function matchAuthorLists(local: string[], source: string[]): AuthorMatchResult {
  const parsedLocal = local.map(parseName);
  const parsedSource = source.map(parseName);

  const n = parsedLocal.length;
  const m = parsedSource.length;

  if (n === 0 && m === 0) {
    return { score: 1, pairs: [], unmatchedLocal: [], unmatchedSource: [], conflicts: [] };
  }

  // Build compatibility matrix
  const compatMatrix: NameCompatibility[][] = [];
  const costMatrix: number[][] = [];

  for (let i = 0; i < n; i++) {
    compatMatrix[i] = [];
    costMatrix[i] = [];
    for (let j = 0; j < m; j++) {
      const c = namesCompatible(parsedLocal[i]!, parsedSource[j]!);
      compatMatrix[i]![j] = c;
      // Cost: lower = better. exact=0, compatible=1, ambiguous=3, incompatible=10
      costMatrix[i]![j] = c === "exact" ? 0 : c === "compatible" ? 1 : c === "ambiguous" ? 3 : 10;
    }
  }

  // Hungarian algorithm for optimal assignment
  const assignment = hungarian(costMatrix, n, m);

  const pairs: AuthorMatchResult["pairs"] = [];
  const matchedLocal = new Set<number>();
  const matchedSource = new Set<number>();

  for (let i = 0; i < n; i++) {
    const j = assignment[i]!;
    if (j !== -1 && compatMatrix[i]![j]! !== "incompatible") {
      pairs.push({ local: i, source: j, compat: compatMatrix[i]![j]! });
      matchedLocal.add(i);
      matchedSource.add(j);
    }
  }

  const unmatchedLocal = [...Array(n).keys()].filter((i) => !matchedLocal.has(i));
  const unmatchedSource = [...Array(m).keys()].filter((j) => !matchedSource.has(j));

  // Build conflicts
  const conflicts: AuthorConflict[] = [];

  for (const p of pairs) {
    if (p.compat === "incompatible") {
      conflicts.push({
        type: "name_mismatch",
        severity: "error",
        description: `Author #${p.local + 1} "${local[p.local]}" vs source #${p.source + 1} "${source[p.source]}"`,
      });
    } else if (p.compat === "ambiguous") {
      conflicts.push({
        type: "name_mismatch",
        severity: "warning",
        description: `Ambiguous match: #${p.local + 1} "${local[p.local]}" ↔ #${p.source + 1} "${source[p.source]}"`,
      });
    } else if (p.local !== p.source) {
      conflicts.push({
        type: "order_shift",
        severity: "info",
        description: `Position shift: "${local[p.local]}" local #${p.local + 1} → source #${p.source + 1}`,
      });
    }
  }

  for (const i of unmatchedLocal) {
    conflicts.push({
      type: "missing_author",
      severity: "warning",
      description: `Local author #${i + 1} "${local[i]}" not found in source`,
    });
  }

  for (const j of unmatchedSource) {
    conflicts.push({
      type: "extra_author",
      severity: "warning",
      description: `Source author #${j + 1} "${source[j]}" not found in local`,
    });
  }

  // Overall score: ratio of good matches to max list size
  const goodPairs = pairs.filter((p) => p.compat === "exact" || p.compat === "compatible").length;
  const maxLen = Math.max(n, m);
  const score = maxLen > 0 ? goodPairs / maxLen : 1;

  return { score, pairs, unmatchedLocal, unmatchedSource, conflicts };
}
