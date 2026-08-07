import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { researchIdea } from "../src/tools/idea"
import { researchPlan } from "../src/tools/plan"
import { researchExperiment } from "../src/tools/experiment"
import { researchClaim } from "../src/tools/claim"
import { researchExhibit } from "../src/tools/exhibit"
import { researchPaper } from "../src/tools/paper"
import { researchSubmission } from "../src/tools/submission"
import { seedProject, stubAccessor, stubAuth, stubCache, stubCtx } from "./helpers"
import type { ToolResult } from "@ericsanchezok/synergy-plugin"
import path from "path"
import fs from "fs/promises"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-content-notes-${Date.now()}`)

beforeAll(async () => {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await seedProject(TMP, {
    state: {
      project: "test-content-notes",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      config: {
        participation_mode: "collaborative",
        stalled_days: 7,
        exploration: { depth: "standard", pilot: "enabled", max_refine_rounds: 3, idea_select_score: 8, idea_generators: 3 },
        ground: { max_review_rounds: 2, max_closest_works: 3 },
        design: { max_review_rounds: 5, score_threshold: 7, max_primary_claims: 2, max_new_components: 2 },
        experiment: { max_optimize_rounds: 3, monitor_interval: "30m", significance_level: 0.05, min_seeds: 3, regression_tolerance: 0.05 },
        realize: { max_review_rounds: 3, code_review_threshold: 7, require_sanity_contract: true, require_quality_contract: true },
        compose: { max_revise_rounds: 3 },
      },
      counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
      focus: { since: "2026-01-01T00:00:00Z", phase: "experiment", blocked_on: null },
    },
  })
})

afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

// Helper to read entity .md
async function readMd(dir: string, id: string): Promise<string> {
  return Bun.file(path.join(TMP, ".research", dir, `${id}.md`)).text()
}

// Helper to extract entity ID from tool output
function extractId(output: string): string {
  const match = output.match(/(idea|plan|exp|claim|exh|paper|sub)_\d{3}/)
  if (!match) throw new Error(`Could not extract ID from output: ${output}`)
  return match[0]
}

// ── Deterministic IDs: each test creates its own entities ────────────────────
// Previous version used readdir()[N] which is order-dependent and breaks
// when tests run in different order across bun versions / CI vs local.

let ideaWithContentId: string
let ideaWithTemplateId: string
let planId: string
let expWithContentId: string
let expWithTemplateId: string
let claimId: string
let exhibitId: string
let paperId: string
let subId: string

// ══════════════════════════════════════════════════════════════════════════════
// content param — replaces empty template on create
// ══════════════════════════════════════════════════════════════════════════════

describe("content param on create", () => {
  test("idea: content replaces template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchIdea.execute({
        action: "create",
        title: "OT-based KV sharing",
        content: "## Core Insight\n\nWasserstein distance enables principled cross-request alignment.",
      }, stubCtx) as ToolResult
      ideaWithContentId = extractId(result.output)
      expect(ideaWithContentId).toMatch(/^idea_\d{3}$/)

      const md = await readMd("ideas", ideaWithContentId)
      expect(md).toContain("Wasserstein distance enables principled")
      expect(md).not.toContain("(describe the key insight here)")
    })
  })

  test("idea: no content uses template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchIdea.execute({
        action: "create",
        title: "Entropy-based pruning",
      }, stubCtx) as ToolResult
      ideaWithTemplateId = extractId(result.output)
      expect(ideaWithTemplateId).toMatch(/^idea_\d{3}$/)

      const md = await readMd("ideas", ideaWithTemplateId)
      expect(md).toContain("(describe the key insight here)")
    })
  })

  test("plan: content replaces template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchPlan.execute({
        action: "create",
        title: "AGST Algorithm Plan",
        idea_ref: ideaWithContentId,
        content: "## Overview\n\nAdaptive Geometric Soft-Transport for KV cache sharing.\n\n## Experiments\n\n1. Pilot on 1B model",
      }, stubCtx) as ToolResult
      planId = extractId(result.output)
      expect(planId).toMatch(/^plan_\d{3}$/)

      const md = await readMd("plans", planId)
      expect(md).toContain("Adaptive Geometric Soft-Transport")
      expect(md).not.toContain("(describe the experiment plan here)")
    })
  })

  test("experiment: content replaces template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExperiment.execute({
        action: "register",
        title: "AGST Pilot",
        plan_ref: planId,
        idea_ref: ideaWithContentId,
        group: "sanity",
        content: "## Setup\n\nQwen2.5-1.5B, single GPU, 100 samples.\n\n## Expected\n\nValidate OT distance < 0.1",
      }, stubCtx) as ToolResult
      expWithContentId = extractId(result.output)
      expect(expWithContentId).toMatch(/^exp_\d{3}$/)

      const md = await readMd("experiments", expWithContentId)
      expect(md).toContain("Qwen2.5-1.5B, single GPU")
      expect(md).not.toContain("(observations, analysis, and results go here)")
    })
  })

  test("experiment: no content uses template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExperiment.execute({
        action: "register",
        title: "Scale-up test",
        plan_ref: planId,
      }, stubCtx) as ToolResult
      expWithTemplateId = extractId(result.output)
      expect(expWithTemplateId).toMatch(/^exp_\d{3}$/)

      const md = await readMd("experiments", expWithTemplateId)
      expect(md).toContain("(observations, analysis, and results go here)")
    })
  })

  test("claim: content replaces template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchClaim.execute({
        action: "create",
        title: "OT alignment reduces cache miss",
        evidence: [{ ref: expWithContentId, role: "primary", strength: "strong" }],
        content: "## Claim Statement\n\nOT-based alignment reduces KV cache miss rate by 40% on multi-turn conversations.",
      }, stubCtx) as ToolResult
      claimId = extractId(result.output)
      expect(claimId).toMatch(/^claim_\d{3}$/)

      const md = await readMd("claims", claimId)
      expect(md).toContain("reduces KV cache miss rate by 40%")
      expect(md).not.toContain("(precise statement of what is being claimed)")
    })
  })

  test("exhibit: content replaces template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExhibit.execute({
        action: "create",
        title: "Cache Miss Rate Comparison",
        kind: "figure",
        content: "## Description\n\nBar chart comparing miss rates across 5 methods.\n\n## Caption\n\nFigure 1: Cache miss rate reduction.",
      }, stubCtx) as ToolResult
      exhibitId = extractId(result.output)
      expect(exhibitId).toMatch(/^exh_\d{3}$/)

      const md = await readMd("exhibits", exhibitId)
      expect(md).toContain("Bar chart comparing miss rates")
      expect(md).not.toContain("(what this exhibit shows and why it matters)")
    })
  })

  test("paper: content replaces template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchPaper.execute({
        action: "create",
        title: "Geometric Cache Sharing for LLM Inference",
        content: "## Paper Overview\n\nWe propose AGST, a method for cross-request KV cache sharing.\n\n## Outline\n\n1. Intro\n2. Method\n3. Experiments",
      }, stubCtx) as ToolResult
      paperId = extractId(result.output)
      expect(paperId).toMatch(/^paper_\d{3}$/)

      const md = await readMd("manuscripts", paperId)
      expect(md).toContain("We propose AGST")
      expect(md).not.toContain("(high-level narrative plan)")
    })
  })

  test("submission: content replaces template", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchSubmission.execute({
        action: "create",
        title: "ICML 2027 Submission",
        paper: paperId,
        venue: "ICML 2027",
        content: "## Submission Notes\n\n9 pages + appendix. Anonymized. No code release until acceptance.",
      }, stubCtx) as ToolResult
      subId = extractId(result.output)
      expect(subId).toMatch(/^sub_\d{3}$/)

      const md = await readMd("submissions", subId)
      expect(md).toContain("9 pages + appendix")
      expect(md).not.toContain("(venue requirements, formatting notes")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// notes param — append-only on status changes
// ══════════════════════════════════════════════════════════════════════════════

describe("notes param on status changes", () => {
  test("experiment complete: notes appended with timestamp", async () => {
    await runWithDirectory(TMP, async () => {
      // Use the experiment created WITH content (expWithContentId)
      await researchExperiment.execute({ action: "schedule", id: expWithContentId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expWithContentId }, stubCtx)

      await researchExperiment.execute({
        action: "complete",
        id: expWithContentId,
        metrics: { accuracy: 0.92, latency_ms: 45 },
        notes: "Converged at epoch 12. OT distance consistently < 0.05. Ready for scale-up.",
      }, stubCtx)

      const md = await readMd("experiments", expWithContentId)
      // Original content preserved
      expect(md).toContain("Qwen2.5-1.5B, single GPU")
      // Notes appended with action name and timestamp
      expect(md).toContain("## Complete —")
      expect(md).toContain("Converged at epoch 12")
      expect(md).toContain("---") // separator
    })
  })

  test("experiment fail: notes appended", async () => {
    await runWithDirectory(TMP, async () => {
      // Use the experiment created WITHOUT content (expWithTemplateId)
      await researchExperiment.execute({ action: "schedule", id: expWithTemplateId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expWithTemplateId }, stubCtx)

      await researchExperiment.execute({
        action: "fail",
        id: expWithTemplateId,
        failure_reason: "OOM on 8B model",
        notes: "Need to reduce batch size or use gradient checkpointing. Retry with bs=1.",
      }, stubCtx)

      const md = await readMd("experiments", expWithTemplateId)
      expect(md).toContain("## Fail —")
      expect(md).toContain("Need to reduce batch size")
    })
  })

  test("idea select: notes appended", async () => {
    await runWithDirectory(TMP, async () => {
      // Use the idea created WITH content (has "Wasserstein distance")
      await researchIdea.execute({
        action: "select",
        id: ideaWithContentId,
        notes: "Selected after 3 rounds of adversarial review. Strongest novelty claim among 8 candidates.",
      }, stubCtx)

      const md = await readMd("ideas", ideaWithContentId)
      expect(md).toContain("## Select —")
      expect(md).toContain("Strongest novelty claim among 8 candidates")
      // Original content still there
      expect(md).toContain("Wasserstein distance")
    })
  })

  test("claim support: notes appended", async () => {
    await runWithDirectory(TMP, async () => {
      await researchClaim.execute({
        action: "support",
        id: claimId,
        notes: `${expWithContentId} shows 40% reduction (p < 0.001). Robust across 3 seeds.`,
      }, stubCtx)

      const md = await readMd("claims", claimId)
      expect(md).toContain("## Support —")
      expect(md).toContain("40% reduction (p < 0.001)")
    })
  })

  test("multiple notes accumulate in order", async () => {
    await runWithDirectory(TMP, async () => {
      await researchExhibit.execute({
        action: "render",
        id: exhibitId,
        notes: "Generated with matplotlib. Script: scripts/plot_fig1.py",
      }, stubCtx)

      await researchExhibit.execute({
        action: "verify",
        id: exhibitId,
        notes: "Axis labels correct. Legend matches paper notation. Colors accessible.",
      }, stubCtx)

      await researchExhibit.execute({
        action: "approve",
        id: exhibitId,
        notes: "Final version approved for camera-ready.",
      }, stubCtx)

      const md = await readMd("exhibits", exhibitId)
      expect(md).toContain("## Render —")
      expect(md).toContain("## Verify —")
      expect(md).toContain("## Approve —")

      // Order preserved
      const renderIdx = md.indexOf("## Render")
      const verifyIdx = md.indexOf("## Verify")
      const approveIdx = md.indexOf("## Approve")
      expect(renderIdx).toBeLessThan(verifyIdx)
      expect(verifyIdx).toBeLessThan(approveIdx)
    })
  })

  test("template-preserved experiment still has fail notes after status change", async () => {
    await runWithDirectory(TMP, async () => {
      // expWithTemplateId was failed in an earlier test — verify the fail notes persist
      const md = await readMd("experiments", expWithTemplateId)
      expect(md).toContain("## Fail —")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// lineage warnings in tool output
// ══════════════════════════════════════════════════════════════════════════════

describe("lineage warnings in output", () => {
  test("experiment register without plan/idea shows warning", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExperiment.execute({
        action: "register",
        title: "Orphan experiment",
      }, stubCtx) as ToolResult

      expect(result.output).toContain("⚠️")
      expect(result.output).toContain("plan")
      expect(result.output).toContain("idea")
    })
  })

  test("experiment register with plan+idea shows no warning", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExperiment.execute({
        action: "register",
        title: "Well-linked experiment",
        plan_ref: planId,
        idea_ref: ideaWithContentId,
      }, stubCtx) as ToolResult

      expect(result.output).not.toContain("⚠️ Missing lineage")
    })
  })

  test("plan create without idea shows warning", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchPlan.execute({
        action: "create",
        title: "Orphan plan",
      }, stubCtx) as ToolResult

      expect(result.output).toContain("⚠️")
      expect(result.output).toContain("idea")
    })
  })

  test("claim create without evidence shows warning", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchClaim.execute({
        action: "create",
        title: "Unsupported claim",
      }, stubCtx) as ToolResult

      expect(result.output).toContain("⚠️")
      expect(result.output).toContain("evidence")
    })
  })
})
