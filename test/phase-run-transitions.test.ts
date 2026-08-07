import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { PhaseRunManager } from "../src/phase-run"
import { ResearchFS } from "../src/fs"
import { stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import type { PhaseRun } from "../src/schema"
import { PhaseRun as PhaseRunSchema } from "../src/schema"

// ── Setup helpers ─────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-phase-test-${Date.now()}`)

async function initWithProject() {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await runWithDirectory(undefined, async () => {
    const researchDir = path.join(TMP, ".research")
    await fs.mkdir(path.join(researchDir, "phase_runs"), { recursive: true })
    const state = {
      project: "phase-test",
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
    phase: "explore",
    status: "active",
    created: now,
    updated: now,
    inner_loop: {
      state: "attempt",
      created: now,
      updated: now,
      round: 1,
      attempts: 0,
      stagnation_rounds: 0,
      escalation_count: 0,
      budget: { max_attempts: 6, max_stagnation: 2, max_escalations: 2 },
    },
    human_checkpoints: [],
    artifacts: {},
    ...overrides,
  })
}

// ── VALID_PHASE_RUN_TRANSITIONS ────────────────────────────────────────────────

describe("VALID_PHASE_RUN_TRANSITIONS", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("active can transition to promoted, pivoted, aborted, blocked", async () => {
    await runWithDirectory(undefined, async () => {
      for (const target of ["promoted", "pivoted", "aborted", "blocked"] as const) {
        const run = await PhaseRunManager.create({ phase: "explore" })
        const updated = await PhaseRunManager.update(run!.id, { status: target })
        expect(updated?.status).toBe(target)
      }
    })
  })

  test("blocked can transition to active or aborted", async () => {
    await runWithDirectory(undefined, async () => {
      const run1 = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.update(run1!.id, { status: "blocked" })
      const unblocked = await PhaseRunManager.update(run1!.id, { status: "active" })
      expect(unblocked?.status).toBe("active")

      const run2 = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.update(run2!.id, { status: "blocked" })
      const aborted = await PhaseRunManager.update(run2!.id, { status: "aborted" })
      expect(aborted?.status).toBe("aborted")
    })
  })
})

// ── PhaseRunManager.update() status transitions ───────────────────────────────

describe("PhaseRunManager.update() status transitions", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("active → promoted is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const updated = await PhaseRunManager.update(run!.id, { status: "promoted" })
      expect(updated?.status).toBe("promoted")
    })
  })

  test("active → blocked is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const updated = await PhaseRunManager.update(run!.id, { status: "blocked" })
      expect(updated?.status).toBe("blocked")
    })
  })

  test("active → aborted is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const updated = await PhaseRunManager.update(run!.id, { status: "aborted" })
      expect(updated?.status).toBe("aborted")
    })
  })

  test("active → pivoted is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const updated = await PhaseRunManager.update(run!.id, { status: "pivoted" })
      expect(updated?.status).toBe("pivoted")
    })
  })

  test("blocked → active is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.update(run!.id, { status: "blocked" })
      const updated = await PhaseRunManager.update(run!.id, { status: "active" })
      expect(updated?.status).toBe("active")
    })
  })

  test("blocked → aborted is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.update(run!.id, { status: "blocked" })
      const updated = await PhaseRunManager.update(run!.id, { status: "aborted" })
      expect(updated?.status).toBe("aborted")
    })
  })

  test("active → active (same status) does not throw", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const updated = await PhaseRunManager.update(run!.id, { status: "active" })
      expect(updated?.status).toBe("active")
    })
  })

  test("terminal states cannot transition", async () => {
    await runWithDirectory(undefined, async () => {
      // promoted is terminal
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.update(run!.id, { status: "promoted" })

      await expect(PhaseRunManager.update(run!.id, { status: "active" })).rejects.toThrow(
        /Invalid PhaseRun status transition/
      )
      await expect(PhaseRunManager.update(run!.id, { status: "blocked" })).rejects.toThrow(
        /Invalid PhaseRun status transition/
      )
    })
  })

  test("terminal status promoted cannot transition back to active", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      // Writing directly to bypass schema validation — test the transition logic
      const runFile = PhaseRunManager.resolve(run!.id)
      const current = await ResearchFS.readYaml<PhaseRun>(runFile)
      // Manually set status to "active" (it already is), then try transitioning to a terminal-to-terminal
      // The actual check is: active → promoted works, promoted → active doesn't
      await PhaseRunManager.update(run!.id, { status: "promoted" })
      await expect(PhaseRunManager.update(run!.id, { status: "active" })).rejects.toThrow(
        /Invalid PhaseRun status transition/
      )
    })
  })

  test("update preserves nested objects (deep merge)", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "design" })
      // Patch only inner_loop.state, other inner_loop fields should be preserved
      const updated = await PhaseRunManager.update(run!.id, {
        inner_loop: { ...run!.inner_loop, state: "evaluate" },
      })
      expect(updated?.inner_loop.state).toBe("evaluate")
      expect(updated?.inner_loop.round).toBe(run!.inner_loop.round)
      expect(updated?.inner_loop.budget).toEqual(run!.inner_loop.budget)
    })
  })
})

// ── transitionInnerLoopState ──────────────────────────────────────────────────

describe("transitionInnerLoopState", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("attempt → evaluate is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const updated = await PhaseRunManager.transitionInnerLoopState(run!.id, "evaluate")
      expect(updated?.inner_loop.state).toBe("evaluate")
    })
  })

  test("evaluate → decide is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.transitionInnerLoopState(run!.id, "evaluate")
      const updated = await PhaseRunManager.transitionInnerLoopState(run!.id, "decide")
      expect(updated?.inner_loop.state).toBe("decide")
    })
  })

  test("decide → attempt is valid (iterate)", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.transitionInnerLoopState(run!.id, "evaluate")
      await PhaseRunManager.transitionInnerLoopState(run!.id, "decide")
      const updated = await PhaseRunManager.transitionInnerLoopState(run!.id, "attempt")
      expect(updated?.inner_loop.state).toBe("attempt")
    })
  })

  test("decide → promoted is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.transitionInnerLoopState(run!.id, "evaluate")
      await PhaseRunManager.transitionInnerLoopState(run!.id, "decide")
      const updated = await PhaseRunManager.transitionInnerLoopState(run!.id, "promoted")
      expect(updated?.inner_loop.state).toBe("promoted")
    })
  })

  test("decide → aborted is valid", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.transitionInnerLoopState(run!.id, "evaluate")
      await PhaseRunManager.transitionInnerLoopState(run!.id, "decide")
      const updated = await PhaseRunManager.transitionInnerLoopState(run!.id, "aborted")
      expect(updated?.inner_loop.state).toBe("aborted")
    })
  })

  test("invalid transition attempt → decide throws", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await expect(
        PhaseRunManager.transitionInnerLoopState(run!.id, "decide")
      ).rejects.toThrow(/Invalid inner loop transition.*attempt → decide/)
    })
  })

  test("invalid transition attempt → promoted throws", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await expect(
        PhaseRunManager.transitionInnerLoopState(run!.id, "promoted")
      ).rejects.toThrow(/Invalid inner loop transition/)
    })
  })

  test("terminal inner state cannot transition", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      await PhaseRunManager.transitionInnerLoopState(run!.id, "evaluate")
      await PhaseRunManager.transitionInnerLoopState(run!.id, "decide")
      await PhaseRunManager.transitionInnerLoopState(run!.id, "aborted")
      // aborted is terminal — no transitions out
      await expect(
        PhaseRunManager.transitionInnerLoopState(run!.id, "attempt")
      ).rejects.toThrow(/Invalid inner loop transition/)
    })
  })

  test("returns undefined for nonexistent run", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await PhaseRunManager.transitionInnerLoopState("run_nonexistent", "evaluate")
      expect(result).toBeUndefined()
    })
  })
})

// ── enforceBudget ─────────────────────────────────────────────────────────────

describe("enforceBudget", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("returns none when within budget", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const result = await PhaseRunManager.enforceBudget(run!.id)
      expect(result.forcedAction).toBe("none")
      expect(result.reason).toBe("Within budget")
    })
  })

  test("returns must_decide when attempts exceed max_attempts", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      // Set attempts to exceed budget (default max_attempts: 6)
      await PhaseRunManager.update(run!.id, {
        inner_loop: { ...run!.inner_loop, attempts: 7 },
      })
      const result = await PhaseRunManager.enforceBudget(run!.id)
      expect(result.forcedAction).toBe("must_decide")
      expect(result.reason).toContain("Attempt budget exhausted")
    })
  })

  test("returns must_escalate when stagnation exceeds max_stagnation", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      // Set stagnation to exceed budget (default max_stagnation: 2)
      await PhaseRunManager.update(run!.id, {
        inner_loop: { ...run!.inner_loop, stagnation_rounds: 3 },
      })
      const result = await PhaseRunManager.enforceBudget(run!.id)
      expect(result.forcedAction).toBe("must_escalate")
      expect(result.reason).toContain("Stagnation budget exhausted")
    })
  })

  test("returns none when run not found", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await PhaseRunManager.enforceBudget("run_nonexistent")
      expect(result.forcedAction).toBe("none")
      expect(result.run).toBeUndefined()
    })
  })

  test("returns none when no budget defined", async () => {
    // Directly call enforceBudget with a PhaseRun that has no budget
    const now = new Date().toISOString()
    const runWithoutBudget: PhaseRun = {
      ...makeRun(),
      inner_loop: {
        state: "attempt",
        created: now,
        updated: now,
        round: 1,
        attempts: 0,
        stagnation_rounds: 0,
        escalation_count: 0,
      },
    }
    const result = await PhaseRunManager.enforceBudget("any_id", runWithoutBudget)
    expect(result.forcedAction).toBe("none")
    expect(result.reason).toBe("No budget defined")
    expect(result.run).toBe(runWithoutBudget)
  })
})

// ── recordDecision ────────────────────────────────────────────────────────────

describe("recordDecision", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("iterate decision advances round and resets attempts", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const result = await PhaseRunManager.recordDecision(run!.id, "iterate")
      expect(result.run?.inner_loop.state).toBe("attempt")
      expect(result.run?.inner_loop.round).toBe(2)
      expect(result.run?.inner_loop.attempts).toBe(0)
      expect(result.run?.inner_loop.stagnation_rounds).toBe(0)
      expect(result.budgetWarning).toBeUndefined()
    })
  })

  test("promote decision transitions inner loop to promoted", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const result = await PhaseRunManager.recordDecision(run!.id, "promote", "Great results")
      expect(result.run?.inner_loop.state).toBe("promoted")
      expect(result.run?.status).toBe("promoted")
      expect(result.run?.summary).toBe("Great results")
      expect(result.budgetWarning).toBeUndefined()
    })
  })

  test("pivot decision transitions inner loop to pivoted", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const result = await PhaseRunManager.recordDecision(run!.id, "pivot", "Need to pivot")
      expect(result.run?.inner_loop.state).toBe("pivoted")
      expect(result.run?.status).toBe("pivoted")
    })
  })

  test("abort decision transitions inner loop to aborted", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      const result = await PhaseRunManager.recordDecision(run!.id, "abort", "Unrecoverable")
      expect(result.run?.inner_loop.state).toBe("aborted")
      expect(result.run?.status).toBe("aborted")
    })
  })

  test("iterate rejected when budget exhausted returns budgetWarning", async () => {
    await runWithDirectory(undefined, async () => {
      const run = await PhaseRunManager.create({ phase: "explore" })
      // Exhaust attempts budget
      await PhaseRunManager.update(run!.id, {
        inner_loop: { ...run!.inner_loop, attempts: 7 },
      })
      const result = await PhaseRunManager.recordDecision(run!.id, "iterate")
      expect(result.budgetWarning).toContain("Budget exhausted")
    })
  })

  test("returns run undefined for nonexistent id", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await PhaseRunManager.recordDecision("run_nonexistent", "iterate")
      expect(result.run).toBeUndefined()
    })
  })
})
