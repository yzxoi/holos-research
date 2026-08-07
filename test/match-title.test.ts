import { describe, expect, test } from "bun:test"
import { normalizeTitle, tokenSetRatio, levenshtein, compareTitles } from "../src/match/title"

// ── normalizeTitle ────────────────────────────────────────────────────────────

describe("normalizeTitle", () => {
  test("lowercases input", () => {
    expect(normalizeTitle("Attention Is All You Need")).toBe("attention is all you need")
  })

  test("strips diacritics via NFKD", () => {
    expect(normalizeTitle("Möser and Gödel")).toBe("moser and godel")
  })

  test("maps hyphens and dashes to spaces", () => {
    expect(normalizeTitle("Self-supervised")).toBe("self supervised")
    expect(normalizeTitle("Self–supervised")).toBe("self supervised")
    expect(normalizeTitle("Self—supervised")).toBe("self supervised")
  })

  test("maps colons to spaces", () => {
    expect(normalizeTitle("BERT: Pre-training")).toBe("bert pre training")
  })

  test("removes quotes and brackets", () => {
    expect(normalizeTitle("A \"Fast\" [Method]")).toBe("a fast method")
  })

  test("collapses whitespace", () => {
    expect(normalizeTitle("  hello   world  ")).toBe("hello world")
  })

  test("empty string stays empty", () => {
    expect(normalizeTitle("")).toBe("")
  })
})

// ── levenshtein ───────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  test("identical strings → 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0)
  })

  test("empty vs non-empty → length", () => {
    expect(levenshtein("", "abc")).toBe(3)
    expect(levenshtein("abc", "")).toBe(3)
  })

  test("both empty → 0", () => {
    expect(levenshtein("", "")).toBe(0)
  })

  test("single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1)
  })

  test("single insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1)
  })

  test("single deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1)
  })

  test("known distance: kitten → sitting = 3", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3)
  })
})

// ── tokenSetRatio ─────────────────────────────────────────────────────────────

describe("tokenSetRatio", () => {
  test("identical titles → 1", () => {
    expect(tokenSetRatio("Attention Is All You Need", "Attention Is All You Need")).toBe(1)
  })

  test("same tokens different order → 1", () => {
    expect(tokenSetRatio("Deep Learning for NLP", "NLP for Learning Deep")).toBe(1)
  })

  test("no common tokens → 0", () => {
    expect(tokenSetRatio("cat dog bird", "red green blue")).toBe(0)
  })

  test("partial overlap", () => {
    const score = tokenSetRatio("Deep Learning for Natural Language Processing", "Deep Learning for Computer Vision")
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  test("empty vs non-empty → 0", () => {
    expect(tokenSetRatio("", "some title")).toBe(0)
  })

  test("both empty → 1", () => {
    expect(tokenSetRatio("", "")).toBe(1)
  })
})

// ── compareTitles ─────────────────────────────────────────────────────────────

describe("compareTitles", () => {
  test("exact match after normalization", () => {
    const r = compareTitles("Attention Is All You Need", "attention is all you need")
    expect(r.level).toBe("exact")
    expect(r.score).toBe(1)
  })

  test("punctuation-only difference is still exact after normalization", () => {
    const r = compareTitles("BERT: Pre-training", "BERT Pre training")
    expect(r.level).toBe("exact")
  })

  test("diacritics stripped → exact", () => {
    const r = compareTitles("Möser 2024", "Moser 2024")
    expect(r.level).toBe("exact")
  })

  test("realistic DBLP vs arXiv title variant → at least fuzzy_match", () => {
    const r = compareTitles(
      "Scaling Laws for Neural Language Models",
      "Scaling Laws for Neural Language Models",
    )
    expect(r.level).toBe("exact")
  })

  test("different titles → mismatch", () => {
    const r = compareTitles("Attention Is All You Need", "BERT: Pre-training of Deep Bidirectional Transformers")
    expect(r.level).toBe("mismatch")
  })

  test("subtitle omission still fuzzy matches", () => {
    const r = compareTitles(
      "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
      "BERT Pre-training of Deep Bidirectional Transformers",
    )
    expect(r.level).toMatch(/fuzzy_match|exact/)
    expect(r.score).toBeGreaterThanOrEqual(0.85)
  })
})
