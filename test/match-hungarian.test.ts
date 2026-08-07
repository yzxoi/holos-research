import { describe, expect, test } from "bun:test"
import { hungarian } from "../src/match/hungarian"

describe("hungarian", () => {
  test("1×1 matrix", () => {
    const result = hungarian([[5]], 1, 1)
    expect(result).toEqual([0])
  })

  test("2×2 matrix picks minimum cost assignment", () => {
    // Row 0 is cheaper at col 1, row 1 cheaper at col 0
    const cost = [
      [10, 1],
      [1, 10],
    ]
    const result = hungarian(cost, 2, 2)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)
  })

  test("3×3 classic test matrix", () => {
    const cost = [
      [1, 2, 3],
      [2, 4, 6],
      [3, 6, 9],
    ]
    const result = hungarian(cost, 3, 3)
    // Optimal: (0,0)=1, (1,1)=4, (2,2)=9 or (0,2)=3, (1,1)=4, (2,0)=3
    // Total cost should be minimal — verify each row assigned
    const assigned = result.filter((j) => j !== -1)
    expect(assigned).toHaveLength(3)
    // No duplicate column assignments
    expect(new Set(assigned).size).toBe(3)
  })

  test("rectangular: rows > cols → excess rows unassigned", () => {
    const cost = [
      [1, 2],
      [3, 4],
      [5, 6],
    ]
    const result = hungarian(cost, 3, 2)
    const assigned = result.filter((j) => j !== -1)
    expect(assigned).toHaveLength(2)
    expect(new Set(assigned).size).toBe(2)
  })

  test("rectangular: rows < cols → all rows assigned", () => {
    const cost = [
      [1, 2, 3],
      [4, 5, 6],
    ]
    const result = hungarian(cost, 2, 3)
    expect(result.filter((j) => j !== -1)).toHaveLength(2)
    expect(new Set(result.filter((j) => j !== -1)).size).toBe(2)
  })

  test("all-zero matrix → any assignment is optimal", () => {
    const cost = [
      [0, 0],
      [0, 0],
    ]
    const result = hungarian(cost, 2, 2)
    expect(result.filter((j) => j !== -1)).toHaveLength(2)
  })

  test("large cost values are avoided", () => {
    const cost = [
      [0, 1000],
      [1000, 0],
    ]
    const result = hungarian(cost, 2, 2)
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(1)
  })

  test("1×3 rectangular → single row assigned to cheapest col", () => {
    const cost = [[5, 2, 8]]
    const result = hungarian(cost, 1, 3)
    expect(result[0]).toBe(1) // col 1 has cost 2 (minimum)
  })
})
