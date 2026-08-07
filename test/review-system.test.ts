import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchReview } from "../src/review"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-review-test-${Date.now()}`)

beforeAll(async () => {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await seedProject(TMP, { state: { project: "review-test" }, extraFiles: ["literature/edges.jsonl", "literature/log.jsonl"] })
})

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})

// ══════════════════════════════════════════════════════════════════════════════
// ResearchReview Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("ResearchReview", () => {
  test("addReview writes review entry", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await ResearchReview.addReview("ideas", "idea_001", {
        reviewer: "inspector",
        summary: "Initial review of the idea",
      })

      expect(result.round).toBe(1)

      const jsonlPath = path.join(TMP, ".research", "ideas", "idea_001.reviews.jsonl")
      const exists = await fs.access(jsonlPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)

      const content = await Bun.file(jsonlPath).text()
      const entry = JSON.parse(content.trim())
      expect(entry.reviewer).toBe("inspector")
      expect(entry.summary).toBe("Initial review of the idea")
    })
  })

  test("addReview with review_body writes md file", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await ResearchReview.addReview("ideas", "idea_002", {
        reviewer: "critic",
        summary: "Critical review with body",
        review_body: "# Detailed Review\n\nThis idea has merit but needs more evidence.",
      })

      expect(result.review_file).toBe("idea_002.review.001.md")

      const mdPath = path.join(TMP, ".research", "ideas", "idea_002.review.001.md")
      const mdContent = await Bun.file(mdPath).text()
      expect(mdContent).toContain("Detailed Review")
    })
  })

  test("addReview increments round", async () => {
    await runWithDirectory(TMP, async () => {
      const r1 = await ResearchReview.addReview("plans", "plan_001", {
        reviewer: "auditor",
        summary: "First round review",
      })
      expect(r1.round).toBe(1)

      const r2 = await ResearchReview.addReview("plans", "plan_001", {
        reviewer: "editor",
        summary: "Second round review",
      })
      expect(r2.round).toBe(2)
    })
  })

  test("addReview rejects invalid reviewer role", async () => {
    await runWithDirectory(TMP, async () => {
      expect(
        ResearchReview.addReview("ideas", "idea_003", {
          reviewer: "random_person",
          summary: "Invalid review",
        })
      ).rejects.toThrow("Invalid reviewer role")
    })
  })

  test("readReviews returns all reviews", async () => {
    await runWithDirectory(TMP, async () => {
      await ResearchReview.addReview("experiments", "exp_001", {
        reviewer: "inspector",
        summary: "Review A",
      })
      await ResearchReview.addReview("experiments", "exp_001", {
        reviewer: "critic",
        summary: "Review B",
      })
      await ResearchReview.addReview("experiments", "exp_001", {
        reviewer: "editor",
        summary: "Review C",
      })

      const reviews = await ResearchReview.readReviews("experiments", "exp_001")
      expect(reviews).toHaveLength(3)
      expect(reviews[0].summary).toBe("Review A")
      expect(reviews[1].summary).toBe("Review B")
      expect(reviews[2].summary).toBe("Review C")
    })
  })

  test("readReviews returns empty for non-existent", async () => {
    await runWithDirectory(TMP, async () => {
      const reviews = await ResearchReview.readReviews("ideas", "idea_nonexistent")
      expect(reviews).toEqual([])
    })
  })

  test("countReviews returns count", async () => {
    await runWithDirectory(TMP, async () => {
      await ResearchReview.addReview("claims", "claim_001", {
        reviewer: "inspector",
        summary: "First",
      })
      await ResearchReview.addReview("claims", "claim_001", {
        reviewer: "auditor",
        summary: "Second",
      })

      const count = await ResearchReview.countReviews("claims", "claim_001")
      expect(count).toBe(2)
    })
  })

  test("countReviews returns 0 for non-existent", async () => {
    await runWithDirectory(TMP, async () => {
      const count = await ResearchReview.countReviews("ideas", "idea_no_reviews")
      expect(count).toBe(0)
    })
  })

  test("formatReviewOutput produces readable string", async () => {
    const output = ResearchReview.formatReviewOutput("idea_001", 1, {
      reviewer: "inspector",
      verdict: "pass",
      summary: "This idea looks solid",
      scores: { novelty: 8, feasibility: 7 },
      review_file: "idea_001.review.001.md",
    })

    expect(output).toContain("idea_001")
    expect(output).toContain("round 1")
    expect(output).toContain("inspector")
    expect(output).toContain("pass")
    expect(output).toContain("This idea looks solid")
    expect(output).toContain("novelty: 8")
    expect(output).toContain("feasibility: 7")
  })

  test("review entry has correct schema", async () => {
    await runWithDirectory(TMP, async () => {
      await ResearchReview.addReview("ideas", "idea_schema", {
        reviewer: "auditor",
        summary: "Schema check review",
        focus: "methodology",
        verdict: "revise",
        action_items: ["Add baseline comparison", "Clarify assumptions"],
        scores: { clarity: 6, soundness: 8 },
      })

      const reviews = await ResearchReview.readReviews("ideas", "idea_schema")
      expect(reviews).toHaveLength(1)

      const entry = reviews[0]
      expect(entry.ts).toBeTruthy()
      expect(entry.round).toBe(1)
      expect(entry.reviewer).toBe("auditor")
      expect(entry.summary).toBe("Schema check review")
      expect(entry.focus).toBe("methodology")
      expect(entry.verdict).toBe("revise")
      expect(entry.action_items).toEqual(["Add baseline comparison", "Clarify assumptions"])
      expect(entry.scores).toEqual({ clarity: 6, soundness: 8 })
    })
  })
})
