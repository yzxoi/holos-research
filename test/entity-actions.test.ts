import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { researchIdea } from "../src/tools/idea"
import { researchPlan } from "../src/tools/plan"
import { researchExperiment } from "../src/tools/experiment"
import { researchClaim } from "../src/tools/claim"
import { researchExhibit } from "../src/tools/exhibit"
import { researchPaper } from "../src/tools/paper"
import { researchSubmission } from "../src/tools/submission"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import type { ToolContext, ToolResult } from "@ericsanchezok/synergy-plugin/tool"
import type { StateYaml } from "../src/schema"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-entity-test-${Date.now()}`)

const stubCtx: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test",
  abort: new AbortController().signal,
}

beforeAll(async () => {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await seedProject(TMP, {
    state: {
      project: "test-entity-actions",
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
      focus: { since: "2026-01-01T00:00:00Z", phase: "experiment", blocked_on: null },
    },
    extraFiles: ["journal.jsonl"],
  })
})

afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callIdea(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchIdea.execute({ action, ...params }, stubCtx) as Promise<ToolResult>
}

async function callPlan(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchPlan.execute({ action, ...params }, stubCtx) as Promise<ToolResult>
}

async function callExperiment(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchExperiment.execute({ action, ...params }, stubCtx) as Promise<ToolResult>
}

async function callClaim(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchClaim.execute({ action, ...params }, stubCtx) as Promise<ToolResult>
}

async function callExhibit(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchExhibit.execute({ action, ...params }, stubCtx) as Promise<ToolResult>
}

async function callPaper(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchPaper.execute({ action, ...params }, stubCtx) as Promise<ToolResult>
}

async function callSubmission(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchSubmission.execute({ action, ...params }, stubCtx) as Promise<ToolResult>
}

async function readYaml<T>(dir: string, id: string): Promise<T> {
  const content = await Bun.file(path.join(TMP, ".research", dir, `${id}.yaml`)).text()
  return YAML.parse(content) as T
}

// ══════════════════════════════════════════════════════════════════════════════
// Idea Actions
// ══════════════════════════════════════════════════════════════════════════════

describe("idea actions", () => {
  test("idea select transitions to selected", async () => {
    await runWithDirectory(TMP, async () => {
      // Idea starts as "proposed"; select requires at least "proposed"
      // But the transition table says: proposed → [exploring, parked, rejected]
      // "selected" is only from "grounding". We need to use update to get there,
      // or use the select action which calls transitionStatus("selected") directly.
      // Looking at the code: select calls transitionStatus("selected") which validates
      // against IDEA_TRANSITIONS. So we need to get to "grounding" first.
      const createResult = await callIdea("create", { title: "Test select idea" })
      const id = (createResult.metadata as any).id as string

      // Use update to transition through: proposed → exploring → grounding
      await callIdea("update", { id, force: true, status: "exploring" })
      await callIdea("update", { id, force: true, status: "grounding" })

      // Now select should work
      const result = await callIdea("select", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("selected")

      const yaml = await readYaml<any>("ideas", id)
      expect(yaml.status).toBe("selected")
    })
  })

  test("idea park transitions to parked", async () => {
    await runWithDirectory(TMP, async () => {
      const createResult = await callIdea("create", { title: "Test park idea" })
      const id = (createResult.metadata as any).id as string

      // "proposed" → "parked" is allowed directly
      const result = await callIdea("park", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("parked")

      const yaml = await readYaml<any>("ideas", id)
      expect(yaml.status).toBe("parked")
    })
  })

  test("idea reject transitions to rejected", async () => {
    await runWithDirectory(TMP, async () => {
      const createResult = await callIdea("create", { title: "Test reject idea" })
      const id = (createResult.metadata as any).id as string

      // "proposed" → "rejected" is allowed
      const result = await callIdea("reject", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("rejected")

      const yaml = await readYaml<any>("ideas", id)
      expect(yaml.status).toBe("rejected")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Plan Actions
// ══════════════════════════════════════════════════════════════════════════════

describe("plan actions", () => {
  test("plan approve transitions to approved", async () => {
    await runWithDirectory(TMP, async () => {
      const createResult = await callPlan("create", { title: "Test approve plan" })
      const id = (createResult.metadata as any).id as string

      // draft → refining → approved
      await callPlan("refine", { id })
      const result = await callPlan("approve", { id, approved_by: "user" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("approved")

      const yaml = await readYaml<any>("plans", id)
      expect(yaml.status).toBe("approved")
    })
  })

  test("plan activate transitions to active and auto-supersedes", async () => {
    await runWithDirectory(TMP, async () => {
      // Create two plans, approve both, activate plan_002
      const r1 = await callPlan("create", { title: "Plan A" })
      const id1 = (r1.metadata as any).id as string
      const r2 = await callPlan("create", { title: "Plan B" })
      const id2 = (r2.metadata as any).id as string

      // Approve both
      await callPlan("refine", { id: id1 })
      await callPlan("approve", { id: id1 })
      await callPlan("refine", { id: id2 })
      await callPlan("approve", { id: id2 })

      // Activate first plan
      await callPlan("activate", { id: id1 })
      const yaml1before = await readYaml<any>("plans", id1)
      expect(yaml1before.status).toBe("active")

      // Activate second plan — should auto-supersede first
      const result = await callPlan("activate", { id: id2 })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("active")
      expect(result.output).toContain("Auto-superseded")

      const yaml2 = await readYaml<any>("plans", id2)
      expect(yaml2.status).toBe("active")

      const yaml1after = await readYaml<any>("plans", id1)
      expect(yaml1after.status).toBe("superseded")
    })
  })

  test("plan supersede transitions to superseded", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callPlan("create", { title: "Supersede target" })
      const id = (r.metadata as any).id as string

      await callPlan("refine", { id })
      await callPlan("approve", { id })
      await callPlan("activate", { id })

      const result = await callPlan("supersede", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("superseded")

      const yaml = await readYaml<any>("plans", id)
      expect(yaml.status).toBe("superseded")
    })
  })

  test("plan cancel transitions to cancelled", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callPlan("create", { title: "Cancel target" })
      const id = (r.metadata as any).id as string

      // draft → cancelled is allowed
      const result = await callPlan("cancel", { id, reason: "No longer needed" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("cancelled")

      const yaml = await readYaml<any>("plans", id)
      expect(yaml.status).toBe("cancelled")
    })
  })

  test("plan invalid transition returns error", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callPlan("create", { title: "Invalid transition plan" })
      const id = (r.metadata as any).id as string

      // draft → active is NOT allowed (must go through refining → approved → active)
      const result = await callPlan("activate", { id })
      expect(result.output).toContain("❌")
      expect(result.metadata).toHaveProperty("error", "invalid_transition")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Experiment Status Transitions
// ══════════════════════════════════════════════════════════════════════════════

describe("experiment status transitions", () => {
  test("experiment schedule transitions registered→scheduled", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExperiment("register", { title: "Schedule test", group: "main" })
      const id = (r.metadata as any).id as string

      const result = await callExperiment("schedule", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("scheduled")

      const yaml = await readYaml<any>("experiments", id)
      expect(yaml.status).toBe("scheduled")
    })
  })

  test("experiment start transitions scheduled→running", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExperiment("register", { title: "Start test", group: "main" })
      const id = (r.metadata as any).id as string

      await callExperiment("schedule", { id })
      const result = await callExperiment("start", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("running")

      const yaml = await readYaml<any>("experiments", id)
      expect(yaml.status).toBe("running")
    })
  })

  test("experiment stop transitions running→stopped", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExperiment("register", { title: "Stop test", group: "main" })
      const id = (r.metadata as any).id as string

      await callExperiment("schedule", { id })
      await callExperiment("start", { id })
      const result = await callExperiment("stop", { id })
      expect(result.output).toContain("⏹️")
      expect(result.output).toContain("stopped")

      const yaml = await readYaml<any>("experiments", id)
      expect(yaml.status).toBe("stopped")
    })
  })

  test("experiment invalidate transitions completed→invalidated", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExperiment("register", { title: "Invalidate test", group: "main" })
      const id = (r.metadata as any).id as string

      await callExperiment("schedule", { id })
      await callExperiment("start", { id })
      await callExperiment("complete", { id, metrics: { accuracy: 0.9 } })

      const result = await callExperiment("invalidate", { id, invalidation_reason: "Data leak discovered" })
      expect(result.output).toContain("⚠️")
      expect(result.output).toContain("invalidated")

      const yaml = await readYaml<any>("experiments", id)
      expect(yaml.status).toBe("invalidated")
    })
  })

  test("experiment invalid transition returns error", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExperiment("register", { title: "Invalid transition exp", group: "main" })
      const id = (r.metadata as any).id as string

      // registered → completed is NOT allowed (must be running)
      const result = await callExperiment("complete", { id })
      expect(result.output).toContain("❌")
      expect(result.metadata).toHaveProperty("error", "invalid_transition")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Claim Actions
// ══════════════════════════════════════════════════════════════════════════════

describe("claim actions", () => {
  test("claim qualify adds caveats", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callClaim("create", {
        title: "Test qualify claim",
        caveats: ["Only tested on English data"],
      })
      const id = (r.metadata as any).id as string

      const result = await callClaim("qualify", { id, caveats: ["Limited to classification tasks"], reason: "Scope limited" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("qualified")
      expect(result.output).toContain("Limited to classification tasks")
      expect(result.output).toContain("Only tested on English data")

      const yaml = await readYaml<any>("claims", id)
      expect(yaml.status).toBe("qualified")
      expect(yaml.caveats).toContain("Only tested on English data")
      expect(yaml.caveats).toContain("Limited to classification tasks")
    })
  })

  test("claim retract transitions to retracted", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callClaim("create", { title: "Test retract claim" })
      const id = (r.metadata as any).id as string

      const result = await callClaim("retract", { id, reason: "Evidence contradicts claim" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("retracted")

      const yaml = await readYaml<any>("claims", id)
      expect(yaml.status).toBe("retracted")
    })
  })

  test("claim finalize transitions supported→final", async () => {
    await runWithDirectory(TMP, async () => {
      // Register an evidence-grade experiment with no redlines, complete it
      const expR = await callExperiment("register", {
        title: "Finalize evidence",
        group: "main",
        authenticity: "evidence",
      })
      const expId = (expR.metadata as any).id as string

      // Schedule + start + complete (no redlines, evidence-grade = should pass)
      await callExperiment("schedule", { id: expId })
      await callExperiment("start", { id: expId })
      await callExperiment("complete", { id: expId, metrics: { accuracy: 0.92 } })

      // Create claim with this experiment as evidence
      const claimR = await callClaim("create", {
        title: "Finalize test claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      })
      const claimId = (claimR.metadata as any).id as string

      // Support the claim
      const supportResult = await callClaim("support", { id: claimId })
      expect(supportResult.output).toContain("✅")

      // Finalize
      const result = await callClaim("finalize", { id: claimId })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("final")

      const yaml = await readYaml<any>("claims", claimId)
      expect(yaml.status).toBe("final")
    })
  })

  test("claim finalize blocked by red-line violations", async () => {
    await runWithDirectory(TMP, async () => {
      // Register an experiment with redlines, then violate one
      const expR = await callExperiment("register", {
        title: "Redline violation evidence",
        group: "main",
        redlines: ["R1_metric_immutability"],
        authenticity: "evidence",
      })
      const expId = (expR.metadata as any).id as string

      // Violate the redline
      await callExperiment("update", { id: expId, redline_status: { R1_metric_immutability: "violated" } })

      // Schedule + start + try to complete (will be blocked by redline, so use update to force status)
      await callExperiment("schedule", { id: expId })
      await callExperiment("start", { id: expId })
      // Can't complete due to redline gate, so bypass with update
      await callExperiment("update", { id: expId, force: true, status: "completed" })

      // Create claim with this evidence
      const claimR = await callClaim("create", {
        title: "Redline blocked claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      })
      const claimId = (claimR.metadata as any).id as string

      // Bypass support gate with update to set status to supported
      await callClaim("update", { id: claimId, force: true, status: "supported" })

      // Finalize should be blocked
      const result = await callClaim("finalize", { id: claimId })
      expect(result.output).toContain("❌")
      expect(result.output).toContain("red-line")
      expect(result.metadata).toHaveProperty("error", "redline_blocked")
    })
  })

  test("claim finalize blocked by prototype authenticity", async () => {
    await runWithDirectory(TMP, async () => {
      // Register a prototype-grade experiment
      const expR = await callExperiment("register", {
        title: "Prototype evidence",
        group: "main",
        authenticity: "prototype",
      })
      const expId = (expR.metadata as any).id as string

      // Can't complete a prototype experiment, bypass with update
      await callExperiment("update", { id: expId, force: true, status: "completed" })

      // Create claim with this experiment as evidence
      const claimR = await callClaim("create", {
        title: "Authenticity blocked claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      })
      const claimId = (claimR.metadata as any).id as string

      // Bypass support gate with update
      await callClaim("update", { id: claimId, force: true, status: "supported" })

      // Finalize should be blocked by authenticity gate
      const result = await callClaim("finalize", { id: claimId })
      expect(result.output).toContain("❌")
      expect(result.metadata).toHaveProperty("error", "authenticity_blocked")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Exhibit Actions
// ══════════════════════════════════════════════════════════════════════════════

describe("exhibit actions", () => {
  test("exhibit render→verify→approve lifecycle", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExhibit("create", { title: "Lifecycle exhibit", kind: "figure" })
      const id = (r.metadata as any).id as string

      // Render
      const renderResult = await callExhibit("render", { id })
      expect(renderResult.output).toContain("✅")
      expect(renderResult.output).toContain("rendered")
      const yamlAfterRender = await readYaml<any>("exhibits", id)
      expect(yamlAfterRender.status).toBe("rendered")

      // Verify
      const verifyResult = await callExhibit("verify", { id })
      expect(verifyResult.output).toContain("✅")
      expect(verifyResult.output).toContain("verified")
      const yamlAfterVerify = await readYaml<any>("exhibits", id)
      expect(yamlAfterVerify.status).toBe("verified")

      // Approve
      const approveResult = await callExhibit("approve", { id })
      expect(approveResult.output).toContain("✅")
      expect(approveResult.output).toContain("approved")
      const yamlAfterApprove = await readYaml<any>("exhibits", id)
      expect(yamlAfterApprove.status).toBe("approved")
    })
  })

  test("exhibit supersede transitions to superseded", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExhibit("create", { title: "Supersede exhibit", kind: "table" })
      const id = (r.metadata as any).id as string

      await callExhibit("render", { id })
      const result = await callExhibit("supersede", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("superseded")

      const yaml = await readYaml<any>("exhibits", id)
      expect(yaml.status).toBe("superseded")
    })
  })

  test("exhibit drop transitions to dropped", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExhibit("create", { title: "Drop exhibit", kind: "figure" })
      const id = (r.metadata as any).id as string

      const result = await callExhibit("drop", { id, reason: "Decided not to include" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("dropped")

      const yaml = await readYaml<any>("exhibits", id)
      expect(yaml.status).toBe("dropped")
    })
  })

  test("exhibit invalid transition returns error", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExhibit("create", { title: "Invalid transition exhibit", kind: "figure" })
      const id = (r.metadata as any).id as string

      // draft → approved is NOT allowed (must go through rendered → verified → approved)
      const result = await callExhibit("approve", { id })
      expect(result.output).toContain("Cannot transition")
      expect(result.metadata).toHaveProperty("error", "invalid_transition")
    })
  })

  test("exhibit update status requires force", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callExhibit("create", { title: "Force-gated exhibit", kind: "figure" })
      const id = (r.metadata as any).id as string

      const result = await callExhibit("update", { id, status: "approved" })

      expect(result.metadata).toHaveProperty("error", "force_required")
      const yaml = await readYaml<any>("exhibits", id)
      expect(yaml.status).toBe("draft")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Paper Bindings
// ══════════════════════════════════════════════════════════════════════════════

describe("paper bindings", () => {
  test("paper bind rejects dangling claim and exhibit refs", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callPaper("create", { title: "Binding safety paper" })
      const id = (r.metadata as any).id as string

      const result = await callPaper("bind", { id, claims: ["claim_999"], exhibits: ["exh_999"] })

      expect(result.metadata).toHaveProperty("error", "dangling_refs")
      expect(result.output).toContain("do not exist")

      const yaml = await readYaml<any>("manuscripts", id)
      expect(yaml.claims).toEqual([])
      expect(yaml.exhibits).toEqual([])
    })
  })

  test("paper bind accepts existing claim and exhibit refs", async () => {
    await runWithDirectory(TMP, async () => {
      const claimR = await callClaim("create", { title: "Bound claim" })
      const claimId = (claimR.metadata as any).id as string
      const exhibitR = await callExhibit("create", { title: "Bound exhibit", kind: "figure" })
      const exhibitId = (exhibitR.metadata as any).id as string
      const paperR = await callPaper("create", { title: "Binding success paper" })
      const paperId = (paperR.metadata as any).id as string

      const result = await callPaper("bind", { id: paperId, claims: [claimId], exhibits: [exhibitId] })

      expect(result.output).toContain("✅")
      const yaml = await readYaml<any>("manuscripts", paperId)
      expect(yaml.claims).toEqual([claimId])
      expect(yaml.exhibits).toEqual([exhibitId])
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Submission Lifecycle
// ══════════════════════════════════════════════════════════════════════════════

describe("submission lifecycle", () => {
  test("submission submit transitions preparing→submitted", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callSubmission("create", { title: "Test submission", venue: "NeurIPS 2026" })
      const id = (r.metadata as any).id as string

      const result = await callSubmission("submit", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("submitted")

      const yaml = await readYaml<any>("submissions", id)
      expect(yaml.status).toBe("submitted")
    })
  })

  test("submission enter_rebuttal after under_review", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callSubmission("create", { title: "Rebuttal submission", venue: "ICML 2026" })
      const id = (r.metadata as any).id as string

      await callSubmission("submit", { id })
      // record_round with reviews_received auto-transitions to under_review
      await callSubmission("record_round", { id, round_status: "reviews_received", summary: "3 reviews received" })

      // Verify under_review
      const yamlAfterReview = await readYaml<any>("submissions", id)
      expect(yamlAfterReview.status).toBe("under_review")

      // Enter rebuttal
      const result = await callSubmission("enter_rebuttal", { id })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("rebuttal")

      const yaml = await readYaml<any>("submissions", id)
      expect(yaml.status).toBe("rebuttal")
    })
  })

  test("submission request_revision→resubmit flow", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callSubmission("create", { title: "Revision submission", venue: "ICLR 2027" })
      const id = (r.metadata as any).id as string

      // Get to rebuttal state
      await callSubmission("submit", { id })
      await callSubmission("record_round", { id, round_status: "reviews_received" })
      await callSubmission("enter_rebuttal", { id })

      // Request revision
      const revResult = await callSubmission("request_revision", { id, summary: "Minor revision requested" })
      expect(revResult.output).toContain("✅")
      expect(revResult.output).toContain("revision_requested")

      const yamlAfterRev = await readYaml<any>("submissions", id)
      expect(yamlAfterRev.status).toBe("revision_requested")

      // Resubmit
      const resubResult = await callSubmission("resubmit", { id, summary: "Revised per reviewer comments" })
      expect(resubResult.output).toContain("✅")
      expect(resubResult.output).toContain("resubmitted")

      const yamlAfterResub = await readYaml<any>("submissions", id)
      expect(yamlAfterResub.status).toBe("resubmitted")
    })
  })

  test("submission close with accepted outcome", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callSubmission("create", { title: "Close submission", venue: "AAAI 2027" })
      const id = (r.metadata as any).id as string

      // Get to under_review so we can accept from there
      await callSubmission("submit", { id })
      await callSubmission("record_round", { id, round_status: "reviews_received" })

      // Close with accepted
      const result = await callSubmission("close", { id, outcome: "accepted", summary: "Paper accepted!" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("accepted")

      const yaml = await readYaml<any>("submissions", id)
      expect(yaml.status).toBe("accepted")
    })
  })

  test("submission record_round rejects before submit", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callSubmission("create", { title: "Early round submission", venue: "ACL 2027" })
      const id = (r.metadata as any).id as string

      const result = await callSubmission("record_round", { id, round_status: "reviews_received" })

      expect(result.metadata).toHaveProperty("error", "invalid_state")
      const yaml = await readYaml<any>("submissions", id)
      expect(yaml.status).toBe("preparing")
      expect(yaml.rounds).toEqual([])
    })
  })

  test("submission record_round rejects terminal submissions", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callSubmission("create", { title: "Terminal round submission", venue: "ACL 2027" })
      const id = (r.metadata as any).id as string
      await callSubmission("close", { id, outcome: "closed", summary: "Withdrawn before submission" })

      const result = await callSubmission("record_round", { id, round_status: "reviews_received" })

      expect(result.metadata).toHaveProperty("error", "invalid_state")
      const yaml = await readYaml<any>("submissions", id)
      expect(yaml.status).toBe("closed")
      expect(yaml.rounds).toEqual([])
    })
  })

  test("submission update status requires force", async () => {
    await runWithDirectory(TMP, async () => {
      const r = await callSubmission("create", { title: "Force-gated submission", venue: "ACL 2027" })
      const id = (r.metadata as any).id as string

      const result = await callSubmission("update", { id, status: "accepted" })

      expect(result.metadata).toHaveProperty("error", "force_required")
      const yaml = await readYaml<any>("submissions", id)
      expect(yaml.status).toBe("preparing")
    })
  })
})
