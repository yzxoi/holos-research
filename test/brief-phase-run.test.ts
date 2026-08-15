import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { PhaseRunManager } from "../src/phase-run"
import { renderActiveRun, renderBlockedOn, renderPendingCheckpoint, renderCompletedRun, renderSummary } from "../src/brief-render"
import { stubAccessor, stubAuth, stubCache } from "./helpers"
import type { PhaseRun, StateYaml } from "../src/schema"
import { PhaseRun as PhaseRunSchema } from "../src/schema"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Setup helpers ─────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-brief-test-${Date.now()}`)

async function initWithProject() {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await runWithDirectory(undefined, async () => {
    const researchDir = path.join(TMP, ".research")
    for (const dir of [
      "ideas", "plans", "experiments", "claims", "exhibits",
      "manuscripts", "submissions", "literature", "literature/by-topic",
      "literature/papers", "phase_runs", "journal", "snapshots",
      "positioning", "code_artifacts", "rqg", "compose", "diagnoses", "checkpoint_briefs",
    ]) {
      await fs.mkdir(path.join(researchDir, dir), { recursive: true })
    }
    await Bun.write(path.join(researchDir, "timeline.jsonl"), "")
    const state = {
      project: "brief-test",
      schema_version: 2,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      config: { participation_mode: "collaborative" },
      counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
    }
    await Bun.write(path.join(researchDir, "state.yaml"), YAML.stringify(state))
  })
}

async function cleanup() {
  await fs.rm(TMP, { recursive: true, force: true })
}

function makeRun(overrides: Partial<PhaseRun> = {}): PhaseRun {
  const now = new Date().toISOString()
  return PhaseRunSchema.parse({
    id: `run_test_${Date.now()}`,
    phase: "design",
    status: "active",
    created: now,
    updated: now,
    inner_loop: {
      state: "attempt",
      created: now,
      updated: now,
      round: 1,
      attempts: 2,
      stagnation_rounds: 0,
      escalation_count: 0,
      budget: { max_attempts: 6, max_stagnation: 2, max_escalations: 2 },
      progress_metric: { name: "accuracy", previous: 0.82, current: 0.85 },
      summary: "Testing model variants",
    },
    human_checkpoints: [],
    artifacts: {},
    ...overrides,
  })
}

function makeState(overrides: Partial<StateYaml> = {}): StateYaml {
  return {
    project: "brief-test",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    config: { participation_mode: "collaborative" },
    counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
    focus: {
      since: new Date().toISOString(),
      phase: "design",
    },
    ...overrides,
  } as StateYaml
}

// ── Brief Render tests ────────────────────────────────────────────────────────

describe("Brief Render", () => {
  test("renderActiveRun shows working state", () => {
    const run = makeRun({ inner_loop: { ...makeRun().inner_loop, state: "attempt" } })
    const item = renderActiveRun(run)
    expect(item.text).toContain("Working")
  })

  test("renderActiveRun shows evaluating state", () => {
    const run = makeRun({ inner_loop: { ...makeRun().inner_loop, state: "evaluate" } })
    const item = renderActiveRun(run)
    expect(item.text).toContain("Evaluating")
  })

  test("renderActiveRun shows progress metric", () => {
    const run = makeRun()
    const item = renderActiveRun(run)
    expect(item.text).toContain("accuracy")
    expect(item.text).toContain("0.85")
  })

  test("renderActiveRun shows attempt count", () => {
    const run = makeRun({
      inner_loop: {
        ...makeRun().inner_loop,
        attempts: 3,
        budget: { max_attempts: 6, max_stagnation: 2, max_escalations: 2 },
      },
    })
    const item = renderActiveRun(run)
    expect(item.text).toContain("attempt 3/6")
  })

  test("renderBlockedOn shows warning", () => {
    const state = makeState()
    const item = renderBlockedOn("human review", state)
    expect(item.severity).toBe("warning")
    expect(item.text).toContain("human review")
  })

  test("renderPendingCheckpoint shows human severity", () => {
    const run = makeRun()
    const item = renderPendingCheckpoint(run, "taste_selection")
    expect(item.severity).toBe("human")
    expect(item.text).toContain("taste selection")
  })

  test("renderCompletedRun promoted", () => {
    const run = makeRun({ status: "promoted" })
    const item = renderCompletedRun(run)
    expect(item.severity).toBe("promoted")
    expect(item.text).toContain("promoted")
  })

  test("renderCompletedRun pivoted", () => {
    const run = makeRun({
      status: "pivoted",
      pivot: {
        from: "design",
        to: "ground",
        category: "method_failure",
        rationale: "Design assumptions flawed",
        evidence_refs: [],
        alternatives_considered: [],
      },
    })
    const item = renderCompletedRun(run)
    expect(item.severity).toBe("pivoted")
    expect(item.text).toContain("method failure")
    expect(item.text).toContain("Design assumptions flawed")
  })

  test("renderCompletedRun aborted", () => {
    const run = makeRun({ status: "aborted", summary: "Unrecoverable error" })
    const item = renderCompletedRun(run)
    expect(item.severity).toBe("aborted")
    expect(item.text).toContain("Aborted")
  })

  test("renderSummary produces sentence", () => {
    const doing = [{ text: "Working in Design", phase: "design", severity: "active" as const }]
    const done = [
      { text: "Completed Explore", phase: "explore", severity: "promoted" as const },
      { text: "Pivoted in Ground", phase: "ground", severity: "pivoted" as const },
    ]
    const summary = renderSummary(doing, done, "design", null)
    expect(summary).toContain("Design")
    expect(summary).toContain("1 phase completed")
    expect(summary).toContain("1 pivot")
  })
})

// ── PhaseRun Context Refresh tests ────────────────────────────────────────────

describe("PhaseRun Context Refresh", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("refreshContext sets context_refresh field", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      const refreshed = await PhaseRunManager.refreshContext(run!.id, {
        trigger: "ground.loop_start",
        anchor: "idea_001",
        active_refs: { idea_ref: "idea_001" },
        used_wiki_refs: ["wiki_transformer"],
        checked_skill_rules: ["skill_explore"],
        drift_check: { status: "pass" },
      })
      expect(refreshed?.context_refresh).toBeDefined()
      expect(refreshed!.context_refresh!.trigger).toBe("ground.loop_start")
      expect(refreshed!.context_refresh!.loaded.anchor).toBe("idea_001")
    })
  })

  test("refreshContext stores trigger and anchor", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      const refreshed = await PhaseRunManager.refreshContext(run!.id, {
        trigger: "ground.loop_start",
        anchor: "idea_001",
        active_refs: { idea_ref: "idea_001" },
      })
      expect(refreshed?.context_refresh?.trigger).toBe("ground.loop_start")
      expect(refreshed?.context_refresh?.loaded.anchor).toBe("idea_001")
    })
  })

  test("refreshContext stores drift_check", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      const refreshed = await PhaseRunManager.refreshContext(run!.id, {
        trigger: "ground.loop_start",
        anchor: "idea_001",
        active_refs: { idea_ref: "idea_001" },
        drift_check: { status: "pass", note: "On track" },
      })
      expect(refreshed?.context_refresh?.drift_check?.status).toBe("pass")
      expect(refreshed?.context_refresh?.drift_check?.note).toBe("On track")
    })
  })

  test("validateContextRefresh passes for valid refresh", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      await PhaseRunManager.refreshContext(run!.id, {
        trigger: "design.loop_start",
        anchor: "idea_001",
        active_refs: { idea: "idea_001" } as any,
        used_wiki_refs: ["wiki_attention"],
        checked_skill_rules: ["skill_design", "skill_eval"],
        drift_check: { status: "pass" },
      })
      const result = await PhaseRunManager.validateContextRefresh(run!.id)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  test("validateContextRefresh fails without context_refresh", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      const result = await PhaseRunManager.validateContextRefresh(run!.id)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.includes("No context refresh"))).toBe(true)
    })
  })

  test("validateContextRefresh fails with drift_check block", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      await PhaseRunManager.refreshContext(run!.id, {
        trigger: "design.loop_start",
        anchor: "idea_001",
        active_refs: { idea_ref: "idea_001" },
        used_wiki_refs: ["wiki_attention"],
        checked_skill_rules: ["skill_design"],
        drift_check: { status: "block", note: "Scope has drifted" },
      })
      const result = await PhaseRunManager.validateContextRefresh(run!.id)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes("block"))).toBe(true)
    })
  })

  test("recordDecision iterate increments round", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      const result = await PhaseRunManager.recordDecision(run!.id, "iterate")
      expect(result.run?.inner_loop.round).toBe(2)
      expect(result.run?.inner_loop.state).toBe("attempt")
    })
  })

  test("recordDecision promote sets terminal state", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      const result = await PhaseRunManager.recordDecision(run!.id, "promote", "Results are strong")
      expect(result.run?.status).toBe("promoted")
      expect(result.run?.inner_loop.state).toBe("promoted")
    })
  })
})

// ── PhaseRun Budget & Stagnation tests ────────────────────────────────────────

describe("PhaseRun Budget & Stagnation", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("checkStagnation detects stagnant run", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      // Set progress metric where current <= previous
      await PhaseRunManager.update(run!.id, {
        inner_loop: {
          ...run!.inner_loop,
          progress_metric: { name: "accuracy", previous: 0.85, current: 0.83 },
        },
      })
      const result = await PhaseRunManager.checkStagnation(run!.id)
      expect(result.isStagnant).toBe(true)
    })
  })

  test("checkStagnation detects progressing run", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      // Set progress metric where current > previous
      await PhaseRunManager.update(run!.id, {
        inner_loop: {
          ...run!.inner_loop,
          progress_metric: { name: "accuracy", previous: 0.80, current: 0.90 },
        },
      })
      const result = await PhaseRunManager.checkStagnation(run!.id)
      expect(result.isStagnant).toBe(false)
    })
  })

  test("enforceBudget returns none when under budget", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      // Default attempts=0, max_attempts=6 — well under budget
      const result = await PhaseRunManager.enforceBudget(run!.id)
      expect(result.forcedAction).toBe("none")
    })
  })

  test("enforceBudget returns must_decide when over budget", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      await PhaseRunManager.update(run!.id, {
        inner_loop: {
          ...run!.inner_loop,
          attempts: 7, // exceeds default max_attempts of 6
        },
      })
      const result = await PhaseRunManager.enforceBudget(run!.id)
      expect(result.forcedAction).toBe("must_decide")
      expect(result.reason).toContain("Attempt budget exhausted")
    })
  })

  test("checkStagnation increments stagnation_rounds", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design", summary: "test run" })
      // Set stagnant metric and an initial stagnation count
      await PhaseRunManager.update(run!.id, {
        inner_loop: {
          ...run!.inner_loop,
          progress_metric: { name: "accuracy", previous: 0.85, current: 0.83 },
          stagnation_rounds: 1,
        },
      })
      const result = await PhaseRunManager.checkStagnation(run!.id)
      expect(result.isStagnant).toBe(true)
      expect(result.run?.inner_loop.stagnation_rounds).toBe(2)
    })
  })
})
