import { describe, expect, test } from "bun:test"
import { parseName, namesCompatible, matchAuthorLists } from "../src/match/name"
import type { NameCompatibility } from "../src/match/name"

// ── parseName ─────────────────────────────────────────────────────────────────

describe("parseName", () => {
  test('"First Last" format', () => {
    const n = parseName("Adam Smith")
    expect(n.first).toBe("adam")
    expect(n.last).toBe("smith")
    expect(n.middle).toEqual([])
  })

  test('"Last, First" format', () => {
    const n = parseName("Smith, Adam")
    expect(n.first).toBe("adam")
    expect(n.last).toBe("smith")
  })

  test('"First Middle Last" format', () => {
    const n = parseName("Adam J. Smith")
    expect(n.first).toBe("adam")
    expect(n.middle).toEqual(["j"])
    expect(n.last).toBe("smith")
  })

  test('"First Last Jr" suffix', () => {
    const n = parseName("Adam Smith Jr")
    expect(n.first).toBe("adam")
    expect(n.last).toBe("smith")
    expect(n.suffix).toBe("jr")
  })

  test('"First Last III" suffix', () => {
    const n = parseName("Adam Smith III")
    expect(n.first).toBe("adam")
    expect(n.last).toBe("smith")
    expect(n.suffix).toBe("iii")
  })

  test("single name", () => {
    const n = parseName("Confucius")
    expect(n.last).toBe("confucius")
    expect(n.first).toBe("")
  })

  test("hyphenated first name", () => {
    const n = parseName("Jean-Pierre Dupont")
    expect(n.first).toBe("jean-pierre")
    expect(n.last).toBe("dupont")
  })

  test("East Asian surname in first position → ambiguousOrder", () => {
    const n = parseName("Wang Wei")
    expect(n.ambiguousOrder).toBe(true)
  })

  test("East Asian surname in last position with non-surname first → not ambiguous", () => {
    const n = parseName("Eric Wang")
    // "eric" is not a surname, "wang" is — normal Western order
    expect(n.ambiguousOrder).toBe(false)
  })

  test("Both parts are East Asian surnames → ambiguous", () => {
    // "wei" (魏/韦) and "wang" (王) are both common Chinese surnames
    const n = parseName("Wei Wang")
    expect(n.ambiguousOrder).toBe(true)
  })

  test("both parts are East Asian surnames → ambiguous", () => {
    const n = parseName("Li Chen")
    expect(n.ambiguousOrder).toBe(true)
  })

  test("Korean name → ambiguousOrder", () => {
    const n = parseName("Kim Min-su")
    expect(n.ambiguousOrder).toBe(true)
  })

  test("Vietnamese name → ambiguousOrder", () => {
    const n = parseName("Nguyen Van An")
    expect(n.ambiguousOrder).toBe(true)
  })

  test("trailing period on first name is stripped", () => {
    const n = parseName("A. Smith")
    expect(n.first).toBe("a")
    expect(n.last).toBe("smith")
  })
})

// ── namesCompatible ───────────────────────────────────────────────────────────

describe("namesCompatible", () => {
  function compat(a: string, b: string): NameCompatibility {
    return namesCompatible(parseName(a), parseName(b))
  }

  test("identical names → exact", () => {
    expect(compat("Adam Smith", "Adam Smith")).toBe("exact")
  })

  test("initial vs full first name → compatible", () => {
    expect(compat("A. Smith", "Adam Smith")).toBe("compatible")
  })

  test("hyphenated name vs split name → not currently handled as compatible", () => {
    // "Jean-Pierre Dupont" parses as first="jean-pierre", last="dupont"
    // "Jean Pierre Dupont" parses as first="jean", middle=["pierre"], last="dupont"
    // The first names differ ("jean-pierre" vs "jean") and removing hyphens
    // gives "jeanpierre" ≠ "jean" — so they are incompatible.
    // This is a known limitation: cross-field hyphen splitting is not implemented.
    expect(compat("Jean-Pierre Dupont", "Jean Pierre Dupont")).toBe("incompatible")
  })

  test("East Asian reversed order → exact (both ambiguous, finds identical pairing)", () => {
    // Both "Wang Wei" and "Wei Wang" have ambiguousOrder=true.
    // The algorithm tries all order combinations and finds "wei wang" vs "wei wang" → exact.
    expect(compat("Wang Wei", "Wei Wang")).toBe("exact")
  })

  test("different first names → incompatible", () => {
    expect(compat("Adam Smith", "Bob Smith")).toBe("incompatible")
  })

  test("different last names → incompatible", () => {
    expect(compat("Adam Smith", "Adam Johnson")).toBe("incompatible")
  })

  test("middle initial present vs absent → exact (unavailable middle is not a conflict)", () => {
    // "Adam J. Smith" → first="adam", middle=["j"], last="smith"
    // "Adam Smith" → first="adam", middle=[], last="smith"
    // Missing middle is "unavailable", not "conflict" — so this is exact match.
    expect(compat("Adam J. Smith", "Adam Smith")).toBe("exact")
  })

  test("conflicting middle initials → ambiguous (known limitation)", () => {
    // J. Smith vs K. Smith: middle names conflict, but first+last match.
    // Returns "ambiguous" rather than "incompatible" — this is conservative.
    // A stricter interpretation would say "incompatible", but the current
    // logic doesn't escalate middle conflict to full incompatibility.
    expect(compat("Adam J. Smith", "Adam K. Smith")).toBe("ambiguous")
  })

  test("symmetric: a→b same as b→a", () => {
    expect(compat("Adam Smith", "A. Smith")).toBe(compat("A. Smith", "Adam Smith"))
  })
})

// ── matchAuthorLists ──────────────────────────────────────────────────────────

describe("matchAuthorLists", () => {
  test("identical lists → score 1, zero conflicts", () => {
    const r = matchAuthorLists(
      ["Adam Smith", "Bob Johnson"],
      ["Adam Smith", "Bob Johnson"],
    )
    expect(r.score).toBe(1)
    expect(r.conflicts).toHaveLength(0)
  })

  test("reordered list → order_shift conflict, score 1", () => {
    const r = matchAuthorLists(
      ["Adam Smith", "Bob Johnson"],
      ["Bob Johnson", "Adam Smith"],
    )
    expect(r.score).toBe(1)
    const shifts = r.conflicts.filter((c) => c.type === "order_shift")
    expect(shifts.length).toBeGreaterThan(0)
  })

  test("missing author → missing_author conflict", () => {
    const r = matchAuthorLists(
      ["Adam Smith", "Bob Johnson", "Carol White"],
      ["Adam Smith", "Bob Johnson"],
    )
    expect(r.unmatchedLocal).toHaveLength(1)
    expect(r.conflicts.some((c) => c.type === "missing_author")).toBe(true)
  })

  test("extra source author → extra_author conflict", () => {
    const r = matchAuthorLists(
      ["Adam Smith"],
      ["Adam Smith", "Bob Johnson"],
    )
    expect(r.unmatchedSource).toHaveLength(1)
    expect(r.conflicts.some((c) => c.type === "extra_author")).toBe(true)
  })

  test("initial vs full name → compatible pair, no error", () => {
    const r = matchAuthorLists(
      ["A. Smith", "Bob Johnson"],
      ["Adam Smith", "Bob Johnson"],
    )
    expect(r.score).toBe(1)
    expect(r.conflicts.some((c) => c.severity === "error")).toBe(false)
  })

  test("completely different authors → low score", () => {
    const r = matchAuthorLists(
      ["Adam Smith", "Bob Johnson"],
      ["Carol White", "Dave Brown"],
    )
    expect(r.score).toBeLessThan(0.5)
  })

  test("empty vs empty → score 1", () => {
    const r = matchAuthorLists([], [])
    expect(r.score).toBe(1)
    expect(r.conflicts).toHaveLength(0)
  })

  test("single author match", () => {
    const r = matchAuthorLists(["Adam Smith"], ["Adam Smith"])
    expect(r.score).toBe(1)
    expect(r.pairs).toHaveLength(1)
  })

  test("East Asian name reversal across list", () => {
    // Real scenario: local has Western order, source has Eastern order
    const r = matchAuthorLists(
      ["Wei Wang", "Min Kim"],
      ["Wang Wei", "Kim Min"],
    )
    // Should find compatible matches despite order difference
    expect(r.pairs.length).toBeGreaterThanOrEqual(2)
  })
})
