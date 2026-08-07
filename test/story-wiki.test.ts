import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { StoryManager } from "../src/story"
import { researchWiki } from "../src/tools/wiki"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import type { ToolContext, ToolResult } from "@ericsanchezok/synergy-plugin/tool"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-story-wiki-test-${Date.now()}`)

const stubCtx: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test",
  abort: new AbortController().signal,
}

beforeAll(async () => {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await seedProject(TMP, { state: { project: "story-wiki-test" }, extraFiles: ["literature/edges.jsonl", "literature/log.jsonl"] })
})

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callWiki(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchWiki.execute({ action: action as any, ...params }, stubCtx) as Promise<ToolResult>
}

// ══════════════════════════════════════════════════════════════════════════════
// StorySpine Tests (1–10)
// ══════════════════════════════════════════════════════════════════════════════

describe("StorySpine", () => {
  test("create story with required fields", async () => {
    await runWithDirectory(TMP, async () => {
      const story = await StoryManager.create({
        id: "story_test1",
        idea_ref: "idea_001",
        field_assumption: "Transformers scale with data",
        pain_point: "Current methods plateau on low-resource languages",
        non_obvious_insight: "Cross-lingual transfer is bottlenecked by tokenization, not model size",
        what_changes_if_true: "We could build effective models for 1000+ languages",
      })

      expect(story.id).toBe("story_test1")
      expect(story.idea_ref).toBe("idea_001")
      expect(story.field_assumption).toBe("Transformers scale with data")
      expect(story.status).toBe("proposed")
      expect(story.version).toBe(1)

      // Verify yaml written
      const yamlPath = path.join(TMP, ".research", "positioning", "story_test1.story.yaml")
      const content = await Bun.file(yamlPath).text()
      const parsed = YAML.parse(content)
      expect(parsed.id).toBe("story_test1")
    })
  })

  test("read story", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_test2",
        idea_ref: "idea_002",
        field_assumption: "RLHF improves alignment",
        pain_point: "Models generate harmful content",
        non_obvious_insight: "Reward hacking is the main failure mode",
        what_changes_if_true: "Safer AI assistants",
      })

      const story = await StoryManager.read("story_test2")
      expect(story).toBeDefined()
      expect(story!.id).toBe("story_test2")
      expect(story!.idea_ref).toBe("idea_002")
      expect(story!.pain_point).toBe("Models generate harmful content")
    })
  })

  test("read returns undefined for non-existent", async () => {
    await runWithDirectory(TMP, async () => {
      const story = await StoryManager.read("story_nonexistent")
      expect(story).toBeUndefined()
    })
  })

  test("update story increments version", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_test3",
        idea_ref: "idea_003",
        field_assumption: "Scaling laws hold",
        pain_point: "Compute cost too high",
        non_obvious_insight: "Efficiency improves at chinchilla-optimal training",
        what_changes_if_true: "10x cheaper training",
      })

      const updated = await StoryManager.update("story_test3", {
        pain_point: "Updated pain point",
      })

      expect(updated).toBeDefined()
      expect(updated!.version).toBe(2)
      expect(updated!.pain_point).toBe("Updated pain point")
    })
  })

  test("update merges fields", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_test4",
        idea_ref: "idea_004",
        field_assumption: "Diffusion models generalize",
        pain_point: "Slow sampling speed",
        non_obvious_insight: "Consistency distillation preserves quality",
        what_changes_if_true: "Real-time generation",
      })

      const updated = await StoryManager.update("story_test4", {
        why_now: "New hardware enables real-time inference",
      })

      expect(updated).toBeDefined()
      expect(updated!.why_now).toBe("New hardware enables real-time inference")
      // Original fields unchanged
      expect(updated!.field_assumption).toBe("Diffusion models generalize")
      expect(updated!.pain_point).toBe("Slow sampling speed")
    })
  })

  test("transition changes status", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_test5",
        idea_ref: "idea_005",
        field_assumption: "Mixture of experts improves efficiency",
        pain_point: "Monolithic models are wasteful",
        non_obvious_insight: "Load balancing is the key challenge",
        what_changes_if_true: "2x faster inference at same quality",
      })

      const transitioned = await StoryManager.transition("story_test5", "grounded")
      expect(transitioned).toBeDefined()
      expect(transitioned!.status).toBe("grounded")
    })
  })

  test("addReframe appends to history", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_test6",
        idea_ref: "idea_006",
        field_assumption: "Curriculum learning helps",
        pain_point: "Training is unstable",
        non_obvious_insight: "Difficulty scheduling matters more than content",
        what_changes_if_true: "Stable training on any data distribution",
      })

      const reframed = await StoryManager.addReframe("story_test6", {
        from_type: "new_method",
        to_type: "method_transfer",
        rationale: "Better fit for existing literature",
      })

      expect(reframed).toBeDefined()
      expect(reframed!.reframe_history).toHaveLength(1)
      expect(reframed!.reframe_history[0].to_type).toBe("method_transfer")
      expect(reframed!.version).toBe(2)
    })
  })

  test("list returns all stories", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_list_a",
        idea_ref: "idea_la",
        field_assumption: "Assumption A",
        pain_point: "Pain A",
        non_obvious_insight: "Insight A",
        what_changes_if_true: "Change A",
      })
      await StoryManager.create({
        id: "story_list_b",
        idea_ref: "idea_lb",
        field_assumption: "Assumption B",
        pain_point: "Pain B",
        non_obvious_insight: "Insight B",
        what_changes_if_true: "Change B",
      })

      const stories = await StoryManager.list()
      expect(stories.length).toBeGreaterThanOrEqual(2)
      const ids = stories.map((s) => s.id)
      expect(ids).toContain("story_list_a")
      expect(ids).toContain("story_list_b")
    })
  })

  test("queryByStatus filters correctly", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_qb_proposed",
        idea_ref: "idea_qp",
        field_assumption: "Assumption P",
        pain_point: "Pain P",
        non_obvious_insight: "Insight P",
        what_changes_if_true: "Change P",
      })
      await StoryManager.create({
        id: "story_qb_confirmed",
        idea_ref: "idea_qc",
        field_assumption: "Assumption C",
        pain_point: "Pain C",
        non_obvious_insight: "Insight C",
        what_changes_if_true: "Change C",
      })
      await StoryManager.transition("story_qb_confirmed", "confirmed")

      const confirmed = await StoryManager.queryByStatus("confirmed")
      expect(confirmed.every((s) => s.status === "confirmed")).toBe(true)
      const ids = confirmed.map((s) => s.id)
      expect(ids).toContain("story_qb_confirmed")
      expect(ids).not.toContain("story_qb_proposed")
    })
  })

  test("getByIdeaRef finds story", async () => {
    await runWithDirectory(TMP, async () => {
      await StoryManager.create({
        id: "story_iref",
        idea_ref: "idea_unique_42",
        field_assumption: "Assumption I",
        pain_point: "Pain I",
        non_obvious_insight: "Insight I",
        what_changes_if_true: "Change I",
      })

      const found = await StoryManager.getByIdeaRef("idea_unique_42")
      expect(found).toBeDefined()
      expect(found!.id).toBe("story_iref")

      const notFound = await StoryManager.getByIdeaRef("idea_nonexistent")
      expect(notFound).toBeUndefined()
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Wiki Tests (11–20)
// ══════════════════════════════════════════════════════════════════════════════

describe("Wiki", () => {
  // resolveMetadata tries multiple adapters (DBLP, S2, arXiv, CrossRef, etc.)
  // each with a 5s timeout — in CI/network-restricted environments this can take 30+ seconds

  test("ingest_paper creates yaml and md", { timeout: 15_000 }, async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callWiki("ingest_paper", {
        title: "Attention Is All You Need",
        authors: ["Vaswani", "Shazeer"],
        year: 2017,
        venue: "NeurIPS",
      })

      expect(result.output).toContain("✅")
      const slug = (result.metadata as any).slug as string
      expect(slug).toBeTruthy()

      const yamlPath = path.join(TMP, ".research", "literature", "papers", `${slug}.yaml`)
      const mdPath = path.join(TMP, ".research", "literature", "papers", `${slug}.md`)

      const yamlExists = await fs.access(yamlPath).then(() => true).catch(() => false)
      const mdExists = await fs.access(mdPath).then(() => true).catch(() => false)
      expect(yamlExists).toBe(true)
      expect(mdExists).toBe(true)

      const yamlContent = YAML.parse(await Bun.file(yamlPath).text())
      expect(yamlContent.title).toBe("Attention Is All You Need")
    })
  })

  test("ingest_paper rejects without title", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callWiki("ingest_paper", {})
      expect(result.output).toContain("Provide at least one of")
      expect((result.metadata as any).error).toBe("missing_identifier")
    })
  })

  test("register_gap creates gap", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callWiki("register_gap", {
        description: "No efficient method for cross-lingual transfer in low-resource settings",
        source_paper: "vaswani2017_attention",
      })

      expect(result.output).toContain("✅")
      expect((result.metadata as any).id).toBe("G01")

      const gapMapPath = path.join(TMP, ".research", "literature", "gap_map.yaml")
      const gapMap = YAML.parse(await Bun.file(gapMapPath).text())
      expect(gapMap.gaps).toHaveLength(1)
      expect(gapMap.gaps[0].id).toBe("G01")
      expect(gapMap.gaps[0].description).toBe("No efficient method for cross-lingual transfer in low-resource settings")
    })
  })

  test("register_gap auto-increments ID", async () => {
    await runWithDirectory(TMP, async () => {
      const r1 = await callWiki("register_gap", { description: "First gap for auto-incr" })
      const r2 = await callWiki("register_gap", { description: "Second gap for auto-incr" })

      const id1 = (r1.metadata as any).id as string
      const id2 = (r2.metadata as any).id as string

      // IDs should be sequential (e.g. G03, G04) with id2 = next after id1
      const num1 = parseInt(id1.replace("G", ""), 10)
      const num2 = parseInt(id2.replace("G", ""), 10)
      expect(num2).toBe(num1 + 1)

      const gapMapPath = path.join(TMP, ".research", "literature", "gap_map.yaml")
      const gapMap = YAML.parse(await Bun.file(gapMapPath).text())
      const ids = gapMap.gaps.map((g: any) => g.id)
      expect(ids).toContain(id1)
      expect(ids).toContain(id2)
    })
  })

  test("link creates edge", { timeout: 15_000 }, async () => {
    await runWithDirectory(TMP, async () => {
      // First ingest a paper to have a known entity
      const ingestResult = await callWiki("ingest_paper", {
        title: "Link Test Paper",
        authors: ["Author A"],
        year: 2024,
      })
      const slug = (ingestResult.metadata as any).slug as string

      // G01 is a valid gap ID format — entityExists returns true for G\d+
      const gapId = "G01"

      const result = await callWiki("link", {
        from: gapId,
        to: slug,
        edge_type: "extends",
        evidence: "Gap identified in related work",
      })

      expect(result.output).toContain("✅")
      expect(result.output).toContain("extends")

      const edgesPath = path.join(TMP, ".research", "literature", "edges.jsonl")
      const edges = (await Bun.file(edgesPath).text()).trim().split("\n").filter(Boolean)
      const lastEdge = JSON.parse(edges[edges.length - 1])
      expect(lastEdge.from).toBe(gapId)
      expect(lastEdge.to).toBe(slug)
      expect(lastEdge.type).toBe("extends")
    })
  })

  test("link rejects non-existent entity", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callWiki("link", {
        from: "idea_999",
        to: "plan_888",
        edge_type: "extends",
      })

      expect(result.output).toContain("does not exist")
      expect((result.metadata as any).error).toBe("entity_not_found")
    })
  })

  test("link accepts existing RQG, diagnosis, and code artifact refs", async () => {
    await runWithDirectory(TMP, async () => {
      const rqgPath = path.join(TMP, ".research", "rqg", "rqg_link_test.yaml")
      const diagPath = path.join(TMP, ".research", "diagnoses", "diag_link_test.yaml")
      const artifactPath = path.join(TMP, ".research", "code_artifacts", "code_artifact_link_test.yaml")

      await Bun.write(rqgPath, YAML.stringify({ id: "rqg_link_test" }))
      await Bun.write(diagPath, YAML.stringify({ id: "diag_link_test" }))
      await Bun.write(artifactPath, YAML.stringify({ id: "code_artifact_link_test" }))

      const rqgDiag = await callWiki("link", {
        from: "rqg_link_test",
        to: "diag_link_test",
        edge_type: "supports",
      })
      const artifactRqg = await callWiki("link", {
        from: "code_artifact_link_test",
        to: "rqg_link_test",
        edge_type: "supports",
      })

      expect(rqgDiag.output).toContain("✅")
      expect(artifactRqg.output).toContain("✅")
    })
  })

  test("update_entry changes relevance", async () => {
    await runWithDirectory(TMP, async () => {
      const ingestResult = await callWiki("ingest_paper", {
        title: "Update Relevance Paper",
        authors: ["Author B"],
        year: 2023,
      })
      const slug = (ingestResult.metadata as any).slug as string

      const result = await callWiki("update_entry", {
        target_id: slug,
        field: "relevance",
        value: "core",
      })

      expect(result.output).toContain("✅")

      const yamlPath = path.join(TMP, ".research", "literature", "papers", `${slug}.yaml`)
      const paper = YAML.parse(await Bun.file(yamlPath).text())
      expect(paper.relevance).toBe("core")
    })
  })

  test("update_entry changes gap status", async () => {
    await runWithDirectory(TMP, async () => {
      // Register a gap and capture its ID
      const gapResult = await callWiki("register_gap", { description: "Gap to close" })
      const gapId = (gapResult.metadata as any).id as string

      const result = await callWiki("update_entry", {
        target_id: gapId,
        field: "status",
        value: "closed",
      })

      expect(result.output).toContain("✅")

      const gapMapPath = path.join(TMP, ".research", "literature", "gap_map.yaml")
      const gapMap = YAML.parse(await Bun.file(gapMapPath).text())
      const gap = gapMap.gaps.find((g: any) => g.id === gapId)
      expect(gap.status).toBe("closed")
    })
  })

  test("stats returns counts", async () => {
    await runWithDirectory(TMP, async () => {
      // Seed some data
      await callWiki("ingest_paper", { title: "Stats Paper Alpha", authors: ["A"], year: 2024 })
      await callWiki("ingest_paper", { title: "Stats Paper Beta", authors: ["B"], year: 2023 })

      const result = await callWiki("stats")
      expect(result.output).toContain("Papers:")
      expect(result.output).toContain("Gaps:")
      expect(result.output).toContain("Edges:")

      const meta = result.metadata as any
      expect(meta.papers).toBeGreaterThanOrEqual(2)
    })
  })

  test("lint detects orphan papers", async () => {
    await runWithDirectory(TMP, async () => {
      // Ingest a paper with no edges — it's an orphan
      await callWiki("ingest_paper", { title: "Orphan Paper No Edges", authors: ["Solo"], year: 2025 })

      const result = await callWiki("lint")
      // The paper with no edges should be flagged as orphan
      expect(result.output).toContain("ORPHAN")
    })
  })
})
