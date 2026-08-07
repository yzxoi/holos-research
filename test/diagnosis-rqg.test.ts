import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { DiagnosisManager } from "../src/diagnosis"
import { RQGManager } from "../src/rqg"
import { ResearchFS } from "../src/fs"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import type { DiagnosisReport, RQGReport, KillCriterion, SufficientCriterion, ExperimentYaml } from "../src/schema"

// ── Setup helpers ─────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-diag-rqg-test-${Date.now()}`)

async function seedExperiment(id: string) {
  const exp: ExperimentYaml = {
    id,
    title: `Test experiment ${id}`,
    status: "completed",
    created: new Date().toISOString(),
    group: "main",
    metrics: { accuracy: 0.85 },
    rqg_contributions: [],
    log: [],
    notes: [],
  }
  await ResearchFS.writeYaml(ResearchFS.resolve("experiments", `${id}.yaml`), exp)
}

async function seedPlan(id: string) {
  const plan = {
    id,
    title: `Test plan ${id}`,
    status: "active",
    created: new Date().toISOString(),
    kill_set: [],
    sufficient_set: [],
    experiment_refs: [],
    code_artifact_refs: [],
    rqg_refs: [],
    diagnosis_refs: [],
  }
  await ResearchFS.writeYaml(ResearchFS.resolve("plans", `${id}.yaml`), plan)
}

function makeExp(overrides: Partial<ExperimentYaml> & { id: string }): ExperimentYaml {
  return {
    title: `Experiment ${overrides.id}`,
    status: "completed",
    created: new Date().toISOString(),
    group: "main",
    rqg_contributions: [],
    log: [],
    notes: [],
    ...overrides,
  }
}

async function cleanup() {
  await fs.rm(TMP, { recursive: true, force: true })
}

// ── DiagnosisManager ──────────────────────────────────────────────────────────

describe("DiagnosisManager", () => {
  beforeAll(async () => {
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
    await seedProject(TMP, { state: { project: "diag-rqg-test" } })
  })
  afterAll(async () => { await cleanup() })

  test("create diagnosis report", async () => {
    await runWithDirectory(undefined, async () => {
      await seedExperiment("exp_test_1")
      await seedPlan("plan_test_1")
      const report = await DiagnosisManager.create({
        experiment_refs: ["exp_test_1"],
        plan_ref: "plan_test_1",
      })
      expect(report.id).toMatch(/^diag_\d+_[a-z0-9]+$/)
      expect(report.experiment_refs).toEqual(["exp_test_1"])
      expect(report.plan_ref).toBe("plan_test_1")
      expect(report.levels).toEqual({})
      // Verify yaml was written
      const readBack = await DiagnosisManager.read(report.id)
      expect(readBack).toBeDefined()
      expect(readBack!.id).toBe(report.id)
    })
  })

  test("create rejects non-existent experiment ref", async () => {
    await runWithDirectory(undefined, async () => {
      await expect(
        DiagnosisManager.create({ experiment_refs: ["exp_nonexistent"] })
      ).rejects.toThrow(/non-existent experiment/)
    })
  })

  test("create rejects non-existent plan ref", async () => {
    await runWithDirectory(undefined, async () => {
      await seedExperiment("exp_test_2")
      await expect(
        DiagnosisManager.create({ experiment_refs: ["exp_test_2"], plan_ref: "plan_nonexistent" })
      ).rejects.toThrow(/non-existent plan/)
    })
  })

  test("read diagnosis report", async () => {
    await runWithDirectory(undefined, async () => {
      await seedExperiment("exp_test_3")
      const created = await DiagnosisManager.create({ experiment_refs: ["exp_test_3"] })
      const read = await DiagnosisManager.read(created.id)
      expect(read).toBeDefined()
      expect(read!.id).toBe(created.id)
      expect(read!.experiment_refs).toEqual(["exp_test_3"])
    })
  })

  test("read returns undefined for non-existent", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await DiagnosisManager.read("diag_nonexistent")
      expect(result).toBeUndefined()
    })
  })

  test("updateLevel sets status and evidence", async () => {
    await runWithDirectory(undefined, async () => {
      await seedExperiment("exp_test_4")
      const created = await DiagnosisManager.create({ experiment_refs: ["exp_test_4"] })
      const updated = await DiagnosisManager.updateLevel(created.id, "L1_training_health", "fail", "Loss diverged at step 500", "Check learning rate")
      expect(updated).toBeDefined()
      expect(updated!.levels.L1_training_health!.status).toBe("fail")
      expect(updated!.levels.L1_training_health!.evidence).toBe("Loss diverged at step 500")
      expect(updated!.levels.L1_training_health!.recommended_action).toBe("Check learning rate")
    })
  })

  test("updateLevel returns undefined for non-existent report", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await DiagnosisManager.updateLevel("diag_nonexistent", "L1_training_health", "fail")
      expect(result).toBeUndefined()
    })
  })

  test("setConclusion sets recommended decision", async () => {
    await runWithDirectory(undefined, async () => {
      await seedExperiment("exp_test_5")
      const created = await DiagnosisManager.create({ experiment_refs: ["exp_test_5"] })
      const updated = await DiagnosisManager.setConclusion(created.id, {
        likely_cause: "Insufficient model capacity",
        recommended_decision: "iterate",
        forbidden_decisions: [],
      })
      expect(updated).toBeDefined()
      expect(updated!.conclusion!.likely_cause).toBe("Insufficient model capacity")
      expect(updated!.conclusion!.recommended_decision).toBe("iterate")
    })
  })

  test("checkAntiGiveUp blocks pivot when all levels pending", async () => {
    const report: DiagnosisReport = {
      id: "diag_empty",
      experiment_refs: ["exp_1"],
      levels: {},
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const result = DiagnosisManager.checkAntiGiveUp(report)
    expect(result.allowed).toBe(false)
    expect(result.forbidden_decisions).toContain("pivot_to_design")
    expect(result.forbidden_decisions).toContain("pivot_to_ground")
  })

  test("checkAntiGiveUp allows when L1-L3 checked", async () => {
    const report: DiagnosisReport = {
      id: "diag_checked",
      experiment_refs: ["exp_1"],
      levels: {
        L1_training_health: { status: "pass" },
        L2_eval_correctness: { status: "pass" },
        L3_data_integrity: { status: "pass" },
      },
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const result = DiagnosisManager.checkAntiGiveUp(report)
    expect(result.allowed).toBe(true)
    expect(result.forbidden_decisions).toEqual([])
  })
})

// ── determinePivotRoute ───────────────────────────────────────────────────────

describe("determinePivotRoute", () => {
  test("L1 fail → pivot to realize", () => {
    const report: DiagnosisReport = {
      id: "diag_l1_fail",
      experiment_refs: ["exp_1"],
      levels: {
        L1_training_health: { status: "fail" },
        L2_eval_correctness: { status: "pass" },
        L3_data_integrity: { status: "pass" },
      },
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const result = DiagnosisManager.determinePivotRoute(report)
    expect(result.decision).toBe("pivot")
    expect(result.target).toBe("realize")
  })

  test("L4 fail → iterate", () => {
    const report: DiagnosisReport = {
      id: "diag_l4_fail",
      experiment_refs: ["exp_1"],
      levels: {
        L1_training_health: { status: "pass" },
        L2_eval_correctness: { status: "pass" },
        L3_data_integrity: { status: "pass" },
        L4_hyperparameter_range: { status: "fail" },
      },
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const result = DiagnosisManager.determinePivotRoute(report)
    expect(result.decision).toBe("iterate")
  })

  test("L6 fail → pivot to ground", () => {
    const report: DiagnosisReport = {
      id: "diag_l6_fail",
      experiment_refs: ["exp_1"],
      levels: {
        L1_training_health: { status: "pass" },
        L2_eval_correctness: { status: "pass" },
        L3_data_integrity: { status: "pass" },
        L4_hyperparameter_range: { status: "pass" },
        L5_seed_stability: { status: "pass" },
        L6_benchmark_story_alignment: { status: "fail" },
      },
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const result = DiagnosisManager.determinePivotRoute(report)
    expect(result.decision).toBe("pivot")
    expect(result.target).toBe("ground")
  })

  test("all pass + no RQG → promote", () => {
    const report: DiagnosisReport = {
      id: "diag_all_pass",
      experiment_refs: ["exp_1"],
      levels: {
        L1_training_health: { status: "pass" },
        L2_eval_correctness: { status: "pass" },
        L3_data_integrity: { status: "pass" },
        L4_hyperparameter_range: { status: "pass" },
        L5_seed_stability: { status: "pass" },
        L6_benchmark_story_alignment: { status: "pass" },
      },
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const result = DiagnosisManager.determinePivotRoute(report)
    expect(result.decision).toBe("promote")
  })

  test("all pass + RQG failed → pivot to design", () => {
    const report: DiagnosisReport = {
      id: "diag_rqg_fail",
      experiment_refs: ["exp_1"],
      levels: {
        L1_training_health: { status: "pass" },
        L2_eval_correctness: { status: "pass" },
        L3_data_integrity: { status: "pass" },
        L4_hyperparameter_range: { status: "pass" },
        L5_seed_stability: { status: "pass" },
        L6_benchmark_story_alignment: { status: "pass" },
      },
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const rqg: RQGReport = {
      id: "rqg_fail",
      plan_ref: "plan_1",
      experiment_refs: [],
      kill_set: [],
      sufficient_set: [],
      integrity: { metric_recompute: "pass", artifact_hash: "pass", redlines: "pass" },
      overall: "failed",
      allowed_next: ["iterate", "pivot"],
      disallowed_next: ["promote"],
      kill_criteria_failed: true,
    }
    const result = DiagnosisManager.determinePivotRoute(report, rqg)
    expect(result.decision).toBe("pivot")
    expect(result.target).toBe("design")
  })

  test("all pass + RQG partial → iterate", () => {
    const report: DiagnosisReport = {
      id: "diag_rqg_partial",
      experiment_refs: ["exp_1"],
      levels: {
        L1_training_health: { status: "pass" },
        L2_eval_correctness: { status: "pass" },
        L3_data_integrity: { status: "pass" },
        L4_hyperparameter_range: { status: "pass" },
        L5_seed_stability: { status: "pass" },
        L6_benchmark_story_alignment: { status: "pass" },
      },
      conclusion: { likely_cause: undefined, recommended_decision: undefined, forbidden_decisions: [] },
    }
    const rqg: RQGReport = {
      id: "rqg_partial",
      plan_ref: "plan_1",
      experiment_refs: [],
      kill_set: [],
      sufficient_set: [],
      integrity: { metric_recompute: "pass", artifact_hash: "pass", redlines: "pass" },
      overall: "partial",
      allowed_next: ["iterate", "pivot", "narrow_claim"],
      disallowed_next: ["promote"],
      kill_criteria_failed: false,
    }
    const result = DiagnosisManager.determinePivotRoute(report, rqg)
    expect(result.decision).toBe("iterate")
  })
})

// ── RQGManager ────────────────────────────────────────────────────────────────

describe("RQGManager", () => {
  beforeAll(async () => {
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
    await seedProject(TMP, { state: { project: "diag-rqg-test" } })
  })
  afterAll(async () => { await cleanup() })

  test("create RQG report", async () => {
    await runWithDirectory(undefined, async () => {
      const killCriteria: KillCriterion[] = [
        { id: "kill_1", experiment_role: "main", metric: "accuracy", direction: "max", baseline_value: 0.5, target_delta: 0.1, min_seeds: 3 },
      ]
      const sufficientCriteria: SufficientCriterion[] = [
        { id: "suff_1", experiment_role: "main", metric: "accuracy", direction: "max", target_value: 0.8, min_seeds: 3 },
      ]
      const report = await RQGManager.create({
        plan_ref: "plan_1",
        experiment_refs: ["exp_1"],
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })
      expect(report.id).toMatch(/^rqg_\d+_[a-z0-9]+$/)
      expect(report.plan_ref).toBe("plan_1")
      expect(report.kill_set).toHaveLength(1)
      expect(report.kill_set[0].id).toBe("kill_1")
      expect(report.kill_set[0].passed).toBe(false)
      expect(report.sufficient_set).toHaveLength(1)
      expect(report.sufficient_set[0].passed).toBe(false)
      expect(report.overall).toBe("invalid")
      // Verify yaml was written
      const readBack = await RQGManager.read(report.id)
      expect(readBack).toBeDefined()
    })
  })

  test("read RQG report", async () => {
    await runWithDirectory(undefined, async () => {
      const report = await RQGManager.create({
        plan_ref: "plan_2",
        experiment_refs: [],
        kill_criteria: [],
        sufficient_criteria: [],
      })
      const read = await RQGManager.read(report.id)
      expect(read).toBeDefined()
      expect(read!.id).toBe(report.id)
      expect(read!.plan_ref).toBe("plan_2")
    })
  })

  test("read returns undefined for non-existent", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await RQGManager.read("rqg_nonexistent")
      expect(result).toBeUndefined()
    })
  })

  test("evaluate with passing kill criteria", async () => {
    await runWithDirectory(undefined, async () => {
      const killCriteria: KillCriterion[] = [
        { id: "kill_1", experiment_role: "main", metric: "accuracy", direction: "max", baseline_value: 0.5, target_delta: 0.1, min_seeds: 3 },
      ]
      const sufficientCriteria: SufficientCriterion[] = [
        { id: "suff_1", experiment_role: "main", metric: "accuracy", direction: "max", target_value: 0.9, min_seeds: 3 },
      ]
      const report = await RQGManager.create({
        plan_ref: "plan_3",
        experiment_refs: ["exp_main_1"],
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      const experiments: ExperimentYaml[] = [
        makeExp({
          id: "exp_main_1",
          metrics: { accuracy: 0.75 },
          code_artifact_ref: "artifact_1",
        }),
      ]

      const evaluated = await RQGManager.evaluate({
        report_id: report.id,
        experiments,
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      // accuracy=0.75, baseline=0.5, delta=0.25 >= target_delta=0.1 → pass
      expect(evaluated.kill_set[0].passed).toBe(true)
    })
  })

  test("evaluate with failing kill criteria", async () => {
    await runWithDirectory(undefined, async () => {
      const killCriteria: KillCriterion[] = [
        { id: "kill_1", experiment_role: "ablations", metric: "accuracy", direction: "max", baseline_value: 0.5, target_delta: 0.3, min_seeds: 3 },
      ]
      const sufficientCriteria: SufficientCriterion[] = []
      const report = await RQGManager.create({
        plan_ref: "plan_4",
        experiment_refs: [],
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      // No matching experiments (group is "main", criterion expects "ablations") → kill criteria fails
      const experiments: ExperimentYaml[] = [
        makeExp({
          id: "exp_main_2",
          group: "main",
          metrics: { accuracy: 0.6 },
        }),
      ]

      const evaluated = await RQGManager.evaluate({
        report_id: report.id,
        experiments,
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      expect(evaluated.kill_set[0].passed).toBe(false)
    })
  })

  test("evaluate sets overall to failed when kill fails", async () => {
    await runWithDirectory(undefined, async () => {
      const killCriteria: KillCriterion[] = [
        { id: "kill_1", experiment_role: "sanity", metric: "loss", direction: "min", baseline_value: 2.0, target_delta: 0.5, min_seeds: 3 },
      ]
      const sufficientCriteria: SufficientCriterion[] = [
        { id: "suff_1", experiment_role: "main", metric: "accuracy", direction: "max", target_value: 0.9, min_seeds: 3 },
      ]
      const report = await RQGManager.create({
        plan_ref: "plan_5",
        experiment_refs: [],
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      // No sanity experiments → kill fails
      const experiments: ExperimentYaml[] = []
      const evaluated = await RQGManager.evaluate({
        report_id: report.id,
        experiments,
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      expect(evaluated.overall).toBe("failed")
      expect(evaluated.allowed_next).toContain("iterate")
      expect(evaluated.allowed_next).toContain("pivot")
      expect(evaluated.disallowed_next).toContain("promote")
      expect(evaluated.kill_criteria_failed).toBe(true)
    })
  })

  test("evaluate sets overall to passed when all pass", async () => {
    await runWithDirectory(undefined, async () => {
      const killCriteria: KillCriterion[] = [
        { id: "kill_1", experiment_role: "main", metric: "accuracy", direction: "max", baseline_value: 0.4, target_delta: 0.1, min_seeds: 3 },
      ]
      const sufficientCriteria: SufficientCriterion[] = [
        { id: "suff_1", experiment_role: "main", metric: "accuracy", direction: "max", target_value: 0.8, min_seeds: 3 },
      ]
      const report = await RQGManager.create({
        plan_ref: "plan_6",
        experiment_refs: [],
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      // accuracy=0.85: kill passes (delta 0.45 >= 0.1), sufficient passes (0.85 >= 0.8)
      const experiments: ExperimentYaml[] = [
        makeExp({
          id: "exp_main_3",
          metrics: { accuracy: 0.85 },
          code_artifact_ref: "artifact_2",
        }),
      ]

      const evaluated = await RQGManager.evaluate({
        report_id: report.id,
        experiments,
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      expect(evaluated.overall).toBe("passed")
      expect(evaluated.allowed_next).toContain("promote")
      expect(evaluated.disallowed_next).toEqual([])
    })
  })

  test("evaluate sets overall to partial", async () => {
    await runWithDirectory(undefined, async () => {
      const killCriteria: KillCriterion[] = [
        { id: "kill_1", experiment_role: "main", metric: "accuracy", direction: "max", baseline_value: 0.4, target_delta: 0.1, min_seeds: 3 },
      ]
      const sufficientCriteria: SufficientCriterion[] = [
        { id: "suff_1", experiment_role: "main", metric: "accuracy", direction: "max", target_value: 0.95, min_seeds: 3 },
        { id: "suff_2", experiment_role: "main", metric: "f1", direction: "max", target_value: 0.9, min_seeds: 3 },
      ]
      const report = await RQGManager.create({
        plan_ref: "plan_7",
        experiment_refs: [],
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      // accuracy=0.85: kill passes, suff_1 fails (0.85 < 0.95)
      // f1=0.92: suff_2 passes (0.92 >= 0.9)
      const experiments: ExperimentYaml[] = [
        makeExp({
          id: "exp_main_4",
          metrics: { accuracy: 0.85, f1: 0.92 },
          code_artifact_ref: "artifact_3",
        }),
      ]

      const evaluated = await RQGManager.evaluate({
        report_id: report.id,
        experiments,
        kill_criteria: killCriteria,
        sufficient_criteria: sufficientCriteria,
      })

      expect(evaluated.overall).toBe("partial")
      expect(evaluated.allowed_next).toContain("iterate")
      expect(evaluated.disallowed_next).toContain("promote")
    })
  })

  test("evaluate integrity check: metric_recompute", async () => {
    await runWithDirectory(undefined, async () => {
      const report = await RQGManager.create({
        plan_ref: "plan_8",
        experiment_refs: [],
        kill_criteria: [],
        sufficient_criteria: [],
      })

      // Completed experiment with non-empty metrics → metric_recompute should be "pass"
      const experiments: ExperimentYaml[] = [
        makeExp({
          id: "exp_main_5",
          metrics: { accuracy: 0.8 },
          code_artifact_ref: "artifact_4",
        }),
      ]

      const evaluated = await RQGManager.evaluate({
        report_id: report.id,
        experiments,
        kill_criteria: [],
        sufficient_criteria: [],
      })

      expect(evaluated.integrity).toBeDefined()
      expect(evaluated.integrity!.metric_recompute).toBe("pass")
    })
  })

  test("updateIntegrity sets overall to invalid on failure", async () => {
    await runWithDirectory(undefined, async () => {
      const report = await RQGManager.create({
        plan_ref: "plan_9",
        experiment_refs: [],
        kill_criteria: [],
        sufficient_criteria: [],
      })

      const updated = await RQGManager.updateIntegrity({
        report_id: report.id,
        metric_recompute: "fail",
      })

      expect(updated.overall).toBe("invalid")
      expect(updated.allowed_next).toEqual(["iterate"])
      expect(updated.disallowed_next).toContain("promote")
      expect(updated.disallowed_next).toContain("pivot")
    })
  })
})
