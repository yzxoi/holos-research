import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { ResearchTimeline } from "../src/timeline"
import { researchExperiment } from "../src/tools/experiment"
import { researchClaim } from "../src/tools/claim"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import type { ToolContext, ToolResult } from "@ericsanchezok/synergy-plugin/tool"
import type { StateYaml, ExperimentYaml } from "../src/schema"
import {
  initRedlineStatus,
  allRedlinesPassed,
  formatRedlineStatus,
} from "../src/tools/shared"
import type { RedlineRule, RedlineStatus, ExperimentRedline } from "../src/schema"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-redline-test-${Date.now()}`)

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
      project: "test-redline",
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
      counters: { idea: 1, plan: 1, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
      focus: { since: "2026-01-01T00:00:00Z", phase: "experiment", blocked_on: null },
    },
  })
})

afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

// ══════════════════════════════════════════════════════════════════════════════
// initRedlineStatus
// ══════════════════════════════════════════════════════════════════════════════

describe("initRedlineStatus", () => {
  test("all rules start as pending", () => {
    const rules: RedlineRule[] = ["R1_metric_immutability", "R3_no_data_leakage", "R6_reproducibility"]
    const status = initRedlineStatus(rules)

    expect(status.R1_metric_immutability).toBe("pending")
    expect(status.R3_no_data_leakage).toBe("pending")
    expect(status.R6_reproducibility).toBe("pending")
    expect(Object.keys(status).length).toBe(3)
  })

  test("empty rules array produces empty status", () => {
    const status = initRedlineStatus([])
    expect(Object.keys(status).length).toBe(0)
  })

  test("all 7 rules initialized", () => {
    const allRules: RedlineRule[] = [
      "R1_metric_immutability", "R2_eval_integrity", "R3_no_data_leakage",
      "R4_honest_reporting", "R5_dataset_integrity", "R6_reproducibility",
      "R7_domain_constraints",
    ]
    const status = initRedlineStatus(allRules)
    expect(Object.keys(status).length).toBe(7)
    for (const r of allRules) expect(status[r]).toBe("pending")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// allRedlinesPassed
// ══════════════════════════════════════════════════════════════════════════════

describe("allRedlinesPassed", () => {
  function makeRedline(overrides: Partial<Record<RedlineRule, RedlineStatus>> = {}): ExperimentRedline {
    const rules: RedlineRule[] = ["R1_metric_immutability", "R3_no_data_leakage", "R6_reproducibility"]
    const status = initRedlineStatus(rules)
    for (const [k, v] of Object.entries(overrides)) {
      status[k as RedlineRule] = v as RedlineStatus
    }
    return { rules, status }
  }

  test("all passed returns true", () => {
    const rl = makeRedline({
      R1_metric_immutability: "passed",
      R3_no_data_leakage: "passed",
      R6_reproducibility: "passed",
    })
    expect(allRedlinesPassed(rl)).toBe(true)
  })

  test("any pending returns false", () => {
    const rl = makeRedline({
      R1_metric_immutability: "passed",
      R3_no_data_leakage: "passed",
      // R6_reproducibility still pending
    })
    expect(allRedlinesPassed(rl)).toBe(false)
  })

  test("any violated returns false", () => {
    const rl = makeRedline({
      R1_metric_immutability: "passed",
      R3_no_data_leakage: "violated",
      R6_reproducibility: "passed",
    })
    expect(allRedlinesPassed(rl)).toBe(false)
  })

  test("any flagged returns false", () => {
    const rl = makeRedline({
      R1_metric_immutability: "passed",
      R3_no_data_leakage: "flagged",
      R6_reproducibility: "passed",
    })
    expect(allRedlinesPassed(rl)).toBe(false)
  })

  test("waived counts as passed", () => {
    const rl = makeRedline({
      R1_metric_immutability: "passed",
      R3_no_data_leakage: "waived",
      R6_reproducibility: "passed",
    })
    expect(allRedlinesPassed(rl)).toBe(true)
  })

  test("mix of passed and waived returns true", () => {
    const rl = makeRedline({
      R1_metric_immutability: "waived",
      R3_no_data_leakage: "passed",
      R6_reproducibility: "waived",
    })
    expect(allRedlinesPassed(rl)).toBe(true)
  })

  test("single rule passed returns true", () => {
    const rl: ExperimentRedline = {
      rules: ["R1_metric_immutability"],
      status: { R1_metric_immutability: "passed" },
    }
    expect(allRedlinesPassed(rl)).toBe(true)
  })

  test("single rule pending returns false", () => {
    const rl: ExperimentRedline = {
      rules: ["R1_metric_immutability"],
      status: { R1_metric_immutability: "pending" },
    }
    expect(allRedlinesPassed(rl)).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// formatRedlineStatus
// ══════════════════════════════════════════════════════════════════════════════

describe("formatRedlineStatus", () => {
  test("shows correct icons for each status", () => {
    const rl: ExperimentRedline = {
      rules: ["R1_metric_immutability", "R3_no_data_leakage", "R6_reproducibility"],
      status: {
        R1_metric_immutability: "passed",
        R3_no_data_leakage: "violated",
        R6_reproducibility: "pending",
      },
    }
    const output = formatRedlineStatus(rl)
    expect(output).toContain("✅")
    expect(output).toContain("❌")
    expect(output).toContain("⏳")
    expect(output).toContain("R1: Metric Immutability")
    expect(output).toContain("R3: No Data Leakage")
    expect(output).toContain("R6: Reproducibility")
  })

  test("shows flagged and waived icons", () => {
    const rl: ExperimentRedline = {
      rules: ["R2_eval_integrity", "R4_honest_reporting"],
      status: {
        R2_eval_integrity: "flagged",
        R4_honest_reporting: "waived",
      },
    }
    const output = formatRedlineStatus(rl)
    expect(output).toContain("⚠️")
    expect(output).toContain("⚪")
  })

  test("shows domain constraints when present", () => {
    const rl: ExperimentRedline = {
      rules: ["R7_domain_constraints"],
      status: { R7_domain_constraints: "passed" },
      domain_constraints: ["Must use Qwen2.5-7B backbone", "Tokenizer must be Qwen official"],
    }
    const output = formatRedlineStatus(rl)
    expect(output).toContain("Domain constraints:")
    expect(output).toContain("Must use Qwen2.5-7B backbone")
    expect(output).toContain("Tokenizer must be Qwen official")
  })

  test("no domain constraints section when empty", () => {
    const rl: ExperimentRedline = {
      rules: ["R7_domain_constraints"],
      status: { R7_domain_constraints: "passed" },
      domain_constraints: [],
    }
    const output = formatRedlineStatus(rl)
    expect(output).not.toContain("Domain constraints:")
  })

  test("no domain constraints section when undefined", () => {
    const rl: ExperimentRedline = {
      rules: ["R7_domain_constraints"],
      status: { R7_domain_constraints: "passed" },
    }
    const output = formatRedlineStatus(rl)
    expect(output).not.toContain("Domain constraints:")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Experiment register with red-lines
// ══════════════════════════════════════════════════════════════════════════════

describe("experiment register with red-lines", () => {
  test("register with red-lines shows them in output", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExperiment.execute({
        action: "register",
        title: "Red-line test experiment",
        plan_ref: "plan_001",
        idea_ref: "idea_001",
        redlines: ["R1_metric_immutability", "R3_no_data_leakage", "R6_reproducibility"],
        domain_constraints: ["Must use Qwen2.5-7B"],
      }, stubCtx) as ToolResult

      expect(result.output).toContain("Red-lines:")
      expect(result.output).toContain("⏳ R1: Metric Immutability")
      expect(result.output).toContain("⏳ R3: No Data Leakage")
      expect(result.output).toContain("⏳ R6: Reproducibility")
      expect(result.output).toContain("Must use Qwen2.5-7B")
    })
  })

  test("register without red-lines shows no red-line section", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExperiment.execute({
        action: "register",
        title: "No red-line experiment",
        plan_ref: "plan_001",
      }, stubCtx) as ToolResult

      expect(result.output).not.toContain("Red-lines:")
    })
  })

  test("register with empty red-lines array shows no section", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await researchExperiment.execute({
        action: "register",
        title: "Empty red-lines",
        redlines: [],
      }, stubCtx) as ToolResult

      expect(result.output).not.toContain("Red-lines:")
    })
  })

  test("red-lines persisted in yaml", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Persist test",
        redlines: ["R1_metric_immutability", "R4_honest_reporting"],
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      expect(idMatch).not.toBeNull()
      const expId = idMatch![0]

      // Read the yaml directly by ID
      const yamlContent = await Bun.file(
        path.join(TMP, ".research", "experiments", `${expId}.yaml`)
      ).text()
      const parsed = YAML.parse(yamlContent)
      expect(parsed.redlines.rules).toContain("R1_metric_immutability")
      expect(parsed.redlines.rules).toContain("R4_honest_reporting")
      expect(parsed.redlines.status.R1_metric_immutability).toBe("pending")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Experiment complete — red-line gate
// ══════════════════════════════════════════════════════════════════════════════

describe("experiment complete red-line gate", () => {
  test("complete blocked when red-lines not all passed", async () => {
    await runWithDirectory(TMP, async () => {
      // Register with red-lines
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Gate test",
        plan_ref: "plan_001",
        redlines: ["R1_metric_immutability", "R6_reproducibility"],
      }, stubCtx) as ToolResult

      // Extract ID from output
      const idMatch = regResult.output.match(/exp_\d+/)
      expect(idMatch).not.toBeNull()
      const expId = idMatch![0]

      // Transition to running first
      await researchExperiment.execute({ action: "schedule", id: expId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expId }, stubCtx)

      // Try to complete without passing red-lines
      const result = await researchExperiment.execute({
        action: "complete",
        id: expId,
        metrics: { accuracy: 0.9 },
      }, stubCtx) as ToolResult

      expect(result.output).toContain("❌")
      expect(result.output).toContain("red-line checks not passed")
      expect(result.metadata.error).toBe("redline_blocked")
    })
  })

  test("complete succeeds when no red-lines declared", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "No gate test",
        plan_ref: "plan_001",
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      await researchExperiment.execute({ action: "schedule", id: expId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expId }, stubCtx)

      const result = await researchExperiment.execute({
        action: "complete",
        id: expId,
        metrics: { accuracy: 0.9 },
      }, stubCtx) as ToolResult

      expect(result.output).toContain("✅")
      expect(result.output).toContain("marked as completed")
    })
  })

  test("complete succeeds after all red-lines passed", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Pass gate test",
        plan_ref: "plan_001",
        redlines: ["R1_metric_immutability", "R6_reproducibility"],
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      // Pass all red-lines
      await researchExperiment.execute({
        action: "update",
        id: expId,
        redline_status: {
          R1_metric_immutability: "passed",
          R6_reproducibility: "passed",
        },
      }, stubCtx)

      await researchExperiment.execute({ action: "schedule", id: expId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expId }, stubCtx)

      // Now complete should work
      const result = await researchExperiment.execute({
        action: "complete",
        id: expId,
        metrics: { accuracy: 0.9 },
      }, stubCtx) as ToolResult

      expect(result.output).toContain("✅")
      expect(result.output).toContain("marked as completed")
      expect(result.output).toContain("Red-lines:")
      expect(result.output).toContain("✅ R1: Metric Immutability")
    })
  })

  test("complete succeeds with waived red-lines", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Waived gate test",
        plan_ref: "plan_001",
        redlines: ["R1_metric_immutability"],
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      await researchExperiment.execute({
        action: "update",
        id: expId,
        redline_status: { R1_metric_immutability: "flagged" },
      }, stubCtx)
      await researchExperiment.execute({
        action: "update",
        id: expId,
        redline_status: { R1_metric_immutability: "waived" },
      }, stubCtx)

      await researchExperiment.execute({ action: "schedule", id: expId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expId }, stubCtx)

      const result = await researchExperiment.execute({
        action: "complete",
        id: expId,
      }, stubCtx) as ToolResult

      expect(result.output).toContain("✅")
      expect(result.output).toContain("marked as completed")
    })
  })

  test("complete blocked when only some red-lines passed", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Partial gate test",
        plan_ref: "plan_001",
        redlines: ["R1_metric_immutability", "R3_no_data_leakage", "R6_reproducibility"],
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      // Pass only R1
      await researchExperiment.execute({
        action: "update",
        id: expId,
        redline_status: { R1_metric_immutability: "passed" },
      }, stubCtx)

      await researchExperiment.execute({ action: "schedule", id: expId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expId }, stubCtx)

      const result = await researchExperiment.execute({
        action: "complete",
        id: expId,
      }, stubCtx) as ToolResult

      expect(result.output).toContain("❌")
      expect(result.output).toContain("red-line checks not passed")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Red-line status update
// ══════════════════════════════════════════════════════════════════════════════

describe("red-line status update", () => {
  test("update individual red-line status", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Update test",
        redlines: ["R1_metric_immutability", "R3_no_data_leakage"],
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      await researchExperiment.execute({
        action: "update",
        id: expId,
        redline_status: { R1_metric_immutability: "passed" },
      }, stubCtx)

      // Verify by reading yaml
      const yamlContent = await Bun.file(
        path.join(TMP, ".research", "experiments", `${expId}.yaml`)
      ).text()
      const parsed = YAML.parse(yamlContent)
      expect(parsed.redlines.status.R1_metric_immutability).toBe("passed")
      expect(parsed.redlines.status.R3_no_data_leakage).toBe("pending") // unchanged
    })
  })

  test("update with invalid rule name is silently ignored", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Invalid rule test",
        redlines: ["R1_metric_immutability"],
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      // Try to update a non-existent rule — should not crash
      const result = await researchExperiment.execute({
        action: "update",
        id: expId,
        redline_status: { R999_fake_rule: "passed" },
      }, stubCtx) as ToolResult

      expect(result.output).toContain("✅")
    })
  })

  test("update red-line on experiment without red-lines is safe", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "No redline update test",
      }, stubCtx) as ToolResult

      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      // Should not crash
      const result = await researchExperiment.execute({
        action: "update",
        id: expId,
        redline_status: { R1_metric_immutability: "passed" },
      }, stubCtx) as ToolResult

      expect(result.output).toContain("✅")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Claim support — red-line gate
// ══════════════════════════════════════════════════════════════════════════════

describe("claim support red-line gate", () => {
  test("claim support blocked when evidence experiment has red-line violations", async () => {
    await runWithDirectory(TMP, async () => {
      // Register experiment WITH red-lines
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Violation evidence",
        plan_ref: "plan_001",
        redlines: ["R1_metric_immutability"],
        authenticity: "evidence",
      }, stubCtx) as ToolResult
      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      // Pass red-lines first, then complete the experiment
      await researchExperiment.execute({
        action: "update", id: expId,
        redline_status: { R1_metric_immutability: "passed" },
      }, stubCtx) as ToolResult
      await researchExperiment.execute({
        action: "update", id: expId, force: true,
        status: "completed",
      }, stubCtx) as ToolResult

      // Now directly modify the YAML to re-violate the red-line
      // (simulating a post-completion audit that finds violations)
      const expPath = path.join(TMP, ".research", "experiments", `${expId}.yaml`)
      const expYaml = YAML.parse(await fs.readFile(expPath, "utf-8")) as any
      expYaml.redlines.status.R1_metric_immutability = "violated"
      await fs.writeFile(expPath, YAML.stringify(expYaml))

      // Create a claim referencing this experiment
      const claimResult = await researchClaim.execute({
        action: "create",
        title: "Test claim with violation",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      }, stubCtx) as ToolResult
      const claimIdMatch = claimResult.output.match(/claim_\d+/)
      const claimId = claimIdMatch![0]

      // Try to support — should be blocked because exp has violated red-lines
      const supportResult = await researchClaim.execute({
        action: "support",
        id: claimId,
      }, stubCtx) as ToolResult

      expect(supportResult.output).toContain("❌")
      expect(supportResult.output).toContain("red-line")
    })
  })

  test("claim support succeeds when evidence experiments pass red-lines", async () => {
    await runWithDirectory(TMP, async () => {
      // Register + pass red-lines + complete
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "Clean evidence",
        plan_ref: "plan_001",
        redlines: ["R1_metric_immutability", "R6_reproducibility"],
      }, stubCtx) as ToolResult
      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      await researchExperiment.execute({
        action: "update", id: expId,
        redline_status: { R1_metric_immutability: "passed", R6_reproducibility: "passed" },
      }, stubCtx)

      await researchExperiment.execute({ action: "schedule", id: expId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expId }, stubCtx)

      await researchExperiment.execute({
        action: "complete", id: expId, metrics: { accuracy: 0.9 },
      }, stubCtx)

      // Create claim
      const claimResult = await researchClaim.execute({
        action: "create",
        title: "Clean claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      }, stubCtx) as ToolResult
      const claimIdMatch = claimResult.output.match(/claim_\d+/)
      const claimId = claimIdMatch![0]

      // Support should succeed
      const supportResult = await researchClaim.execute({
        action: "support",
        id: claimId,
      }, stubCtx) as ToolResult

      expect(supportResult.output).toContain("✅")
      expect(supportResult.output).not.toContain("red-line")
    })
  })

  test("claim support succeeds when evidence has no red-lines declared", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await researchExperiment.execute({
        action: "register",
        title: "No redline evidence",
        plan_ref: "plan_001",
      }, stubCtx) as ToolResult
      const idMatch = regResult.output.match(/exp_\d+/)
      const expId = idMatch![0]

      await researchExperiment.execute({ action: "schedule", id: expId }, stubCtx)
      await researchExperiment.execute({ action: "start", id: expId }, stubCtx)

      await researchExperiment.execute({
        action: "complete", id: expId, metrics: { accuracy: 0.9 },
      }, stubCtx)

      const claimResult = await researchClaim.execute({
        action: "create",
        title: "No redline claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      }, stubCtx) as ToolResult
      const claimIdMatch = claimResult.output.match(/claim_\d+/)
      const claimId = claimIdMatch![0]

      const supportResult = await researchClaim.execute({
        action: "support",
        id: claimId,
      }, stubCtx) as ToolResult

      expect(supportResult.output).toContain("✅")
    })
  })

  test("claim support handles non-existent experiment refs gracefully", async () => {
    await runWithDirectory(TMP, async () => {
      const claimResult = await researchClaim.execute({
        action: "create",
        title: "Ghost evidence claim",
        evidence: [{ ref: "exp_999", role: "primary", strength: "strong" }],
      }, stubCtx) as ToolResult
      const claimIdMatch = claimResult.output.match(/claim_\d+/)
      const claimId = claimIdMatch![0]

      // Should not crash — missing experiment yaml causes authenticity gate to block
      const supportResult = await researchClaim.execute({
        action: "support",
        id: claimId,
      }, stubCtx) as ToolResult

      // Non-existent experiment cannot be verified as evidence-grade
      expect(supportResult.output).toContain("❌")
      expect(supportResult.output).toContain("not evidence-grade")
    })
  })

  test("claim support handles non-experiment evidence refs", async () => {
    await runWithDirectory(TMP, async () => {
      const claimResult = await researchClaim.execute({
        action: "create",
        title: "Non-exp evidence",
        evidence: [{ ref: "paper_001", role: "primary", strength: "strong" }],
      }, stubCtx) as ToolResult
      const claimIdMatch = claimResult.output.match(/claim_\d+/)
      const claimId = claimIdMatch![0]

      // Non-exp_ refs are skipped in red-line check
      const supportResult = await researchClaim.execute({
        action: "support",
        id: claimId,
      }, stubCtx) as ToolResult

      expect(supportResult.output).toContain("✅")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Backward compat — old experiments without redlines field
// ══════════════════════════════════════════════════════════════════════════════

describe("backward compat — no redlines field", () => {
  test("old experiment yaml without redlines completes fine", async () => {
    await runWithDirectory(TMP, async () => {
      // Manually create an old-style experiment yaml
      const oldYaml: any = {
        id: "exp_old",
        title: "Old experiment",
        status: "registered",
        created: "2026-01-01T00:00:00Z",
      }
      await Bun.write(
        path.join(TMP, ".research", "experiments", "exp_old.yaml"),
        YAML.stringify(oldYaml)
      )
      await Bun.write(
        path.join(TMP, ".research", "experiments", "exp_old.md"),
        "## Notes\n\nOld experiment.\n"
      )

      // Transition through proper lifecycle before completing
      await researchExperiment.execute({ action: "schedule", id: "exp_old" }, stubCtx)
      await researchExperiment.execute({ action: "start", id: "exp_old" }, stubCtx)

      // Complete should work (no redlines field = no gate)
      const result = await researchExperiment.execute({
        action: "complete",
        id: "exp_old",
        metrics: { accuracy: 0.85 },
      }, stubCtx) as ToolResult

      expect(result.output).toContain("✅")
      expect(result.output).toContain("marked as completed")
    })
  })
})
