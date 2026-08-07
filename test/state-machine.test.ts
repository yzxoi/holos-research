import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { researchState } from "../src/tools/state"
import { seedProject, stubAccessor, stubAuth, stubCache, stubCtx } from "./helpers"
import type { ToolResult } from "@ericsanchezok/synergy-plugin"
import type { StateYaml } from "../src/schema"
import path from "path"
import os from "os"
import fs from "fs/promises"
import YAML from "yaml"

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATE_MACHINE_CONFIG = {
  participation_mode: "collaborative",
  stalled_days: 7,
  exploration: { depth: "standard", pilot: "enabled", max_refine_rounds: 3, idea_select_score: 8, idea_generators: 3 },
  ground: { max_review_rounds: 2, max_closest_works: 3 },
  design: { max_review_rounds: 5, score_threshold: 7, max_primary_claims: 2, max_new_components: 2 },
  experiment: { max_optimize_rounds: 3, monitor_interval: "30m", significance_level: 0.05, min_seeds: 3, regression_tolerance: 0.05 },
  realize: { max_review_rounds: 3, code_review_threshold: 7, require_sanity_contract: true, require_quality_contract: true },
  compose: { max_revise_rounds: 3 },
}

function makeTmp(label: string) {
  return path.join(os.tmpdir(), `hr-sm-${label}-${Date.now()}`)
}

async function seedStateMachineProject(tmp: string) {
  initContext({ directory: tmp, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await seedProject(tmp, {
    state: {
      project: "state-machine-test",
      config: STATE_MACHINE_CONFIG,
    },
  })
}

function makeHelpers(tmp: string) {
  async function callState(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
    return researchState.execute({ action, ...params } as any, stubCtx) as Promise<ToolResult>
  }

  async function readState(): Promise<StateYaml> {
    const text = await Bun.file(path.join(tmp, ".research", "state.yaml")).text()
    return YAML.parse(text)
  }

  async function readPhaseRun(runId: string) {
    const text = await Bun.file(path.join(tmp, ".research", "phase_runs", `${runId}.yaml`)).text()
    return YAML.parse(text)
  }

  /** Waive all pending checkpoints on the active phase run. */
  async function waiveAllPendingCheckpoints(): Promise<void> {
    const state = await readState()
    if (!state.focus?.active_phase_run) return
    const run = await readPhaseRun(state.focus.active_phase_run)
    for (const cp of (run.human_checkpoints ?? [])) {
      if (cp.status === "pending") {
        await callState("waive_checkpoint", { checkpoint_kind: cp.kind, reason: "test waiver" })
      }
    }
  }

  /** Advance to target_phase, handling the two-step checkpoint flow automatically. */
  async function advanceWithWaive(targetPhase: string): Promise<ToolResult> {
    const first = await callState("advance", { target_phase: targetPhase })
    if (first.metadata?.status === "checkpoints_added") {
      await waiveAllPendingCheckpoints()
      return callState("advance", { target_phase: targetPhase })
    }
    return first
  }

  /** Advance to target_phase, handling the two-step checkpoint flow with confirm. */
  async function advanceWithConfirm(targetPhase: string): Promise<ToolResult> {
    const first = await callState("advance", { target_phase: targetPhase })
    if (first.metadata?.status === "checkpoints_added") {
      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      for (const cp of (run.human_checkpoints ?? [])) {
        if (cp.status === "pending") {
          await callState("confirm_checkpoint", { checkpoint_kind: cp.kind, decision: "approved" })
        }
      }
      return callState("advance", { target_phase: targetPhase })
    }
    return first
  }

  /** Redirect to target_phase, handling the two-step pivot checkpoint flow. */
  async function redirectWithWaive(targetPhase: string, reason: string): Promise<ToolResult> {
    // First waive any existing pending checkpoints
    await waiveAllPendingCheckpoints()
    const first = await callState("redirect", { target_phase: targetPhase, reason })
    if (first.metadata?.status === "pivot_checkpoint_required") {
      await waiveAllPendingCheckpoints()
      return callState("redirect", { target_phase: targetPhase, reason })
    }
    return first
  }

  /** Navigate to a specific phase, starting from whatever the current state is. */
  async function navigateToPhase(targetPhase: string): Promise<void> {
    const state = await readState()
    // Clear focus first if set
    if (state.focus) {
      await callState("abort")
    }
    // Now advance from explore through to target
    const phases = ["explore", "ground", "design", "realize", "experiment", "compose"]
    const targetIdx = phases.indexOf(targetPhase)
    for (let i = 0; i <= targetIdx; i++) {
      await advanceWithWaive(phases[i])
    }
  }

  async function readTimeline(): Promise<any[]> {
    const text = await Bun.file(path.join(tmp, ".research", "timeline.jsonl")).text()
    return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
  }

  return { callState, readState, readPhaseRun, waiveAllPendingCheckpoints, advanceWithWaive, advanceWithConfirm, redirectWithWaive, navigateToPhase, readTimeline }
}

// ══════════════════════════════════════════════════════════════════════════════
// Group 1: Advance Flow
// ══════════════════════════════════════════════════════════════════════════════

describe("Advance Flow", () => {
  const TMP = makeTmp("advance-flow")
  const { callState, readState, readPhaseRun, waiveAllPendingCheckpoints, readTimeline } = makeHelpers(TMP)

  beforeAll(async () => { await seedStateMachineProject(TMP) })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("advance to explore from empty state", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("advance", { target_phase: "explore" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("explore")

      const state = await readState()
      expect(state.focus).toBeDefined()
      expect(state.focus!.phase).toBe("explore")
      expect(state.focus!.active_phase_run).toBeTruthy()
    })
  })

  test("advance rejects non-explore first phase", async () => {
    await runWithDirectory(TMP, async () => {
      // Clear focus
      const state = await readState()
      if (state.focus) {
        await callState("abort")
      }

      const result = await callState("advance", { target_phase: "design" })
      expect(result.output).toContain("first phase must be \"explore\"")
    })
  })

  test("advance rejects non-adjacent transition", async () => {
    await runWithDirectory(TMP, async () => {
      // Ensure we're at explore
      let state = await readState()
      if (!state.focus) {
        await callState("advance", { target_phase: "explore" })
      }

      const result = await callState("advance", { target_phase: "design" })
      expect(result.output).toContain("Cannot advance")
      expect(result.output).toContain("redirect")
    })
  })

  test("advance explore→ground adds taste_selection checkpoint", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("advance", { target_phase: "ground" })
      expect(result.metadata?.status).toBe("checkpoints_added")
      expect(result.output).toContain("Resolve")

      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      const pending = run.human_checkpoints.filter((cp: any) => cp.status === "pending")
      expect(pending.some((cp: any) => cp.kind === "taste_selection")).toBe(true)
    })
  })

  test("advance blocked by pending checkpoints", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("advance", { target_phase: "ground" })
      expect(result.output).toContain("unresolved checkpoint")
    })
  })

  test("advance succeeds after waiving checkpoints", async () => {
    await runWithDirectory(TMP, async () => {
      await waiveAllPendingCheckpoints()
      const result = await callState("advance", { target_phase: "ground" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("ground")

      const state = await readState()
      expect(state.focus!.phase).toBe("ground")
    })
  })

  test("advance succeeds after confirming checkpoints", async () => {
    await runWithDirectory(TMP, async () => {
      // Advance ground→design adds taste_selection + reasonableness_check
      const first = await callState("advance", { target_phase: "design" })
      expect(first.metadata?.status).toBe("checkpoints_added")

      // Confirm all pending checkpoints
      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      for (const cp of (run.human_checkpoints ?? [])) {
        if (cp.status === "pending") {
          await callState("confirm_checkpoint", { checkpoint_kind: cp.kind, decision: "approved" })
        }
      }

      // Second advance succeeds
      const result = await callState("advance", { target_phase: "design" })
      expect(result.output).toContain("✅")
      expect(result.output).toContain("design")

      const newState = await readState()
      expect(newState.focus!.phase).toBe("design")
    })
  })

  test("advance creates snapshot and timeline event", async () => {
    await runWithDirectory(TMP, async () => {
      // Advance design→realize
      const first = await callState("advance", { target_phase: "realize" })
      await waiveAllPendingCheckpoints()
      const result = await callState("advance", { target_phase: "realize" })
      expect(result.output).toContain("✅")

      // Check timeline has focus.changed event
      const events = await readTimeline()
      const focusChanged = events.filter((e: any) => e.type === "focus.changed")
      expect(focusChanged.length).toBeGreaterThan(0)

      // Check snapshot directory exists
      const snapshotDir = path.join(TMP, ".research", "snapshots")
      const entries = await fs.readdir(snapshotDir)
      expect(entries.length).toBeGreaterThan(0)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 2: Full Pipeline Happy Path
// ══════════════════════════════════════════════════════════════════════════════

describe("Full Pipeline Happy Path", () => {
  const TMP = makeTmp("pipeline")
  const { callState, readState, readPhaseRun, advanceWithWaive } = makeHelpers(TMP)

  beforeAll(async () => { await seedStateMachineProject(TMP) })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("advance through all 6 phases", async () => {
    await runWithDirectory(TMP, async () => {
      // Clear any existing focus
      const state = await readState()
      if (state.focus) {
        await callState("abort")
      }

      // Advance through all phases
      const phases = ["explore", "ground", "design", "realize", "experiment", "compose"]
      for (const phase of phases) {
        const result = await advanceWithWaive(phase)
        expect(result.output).toContain("✅")
      }

      const finalState = await readState()
      expect(finalState.focus!.phase).toBe("compose")

      // Count phase runs and statuses
      const phaseRunsDir = path.join(TMP, ".research", "phase_runs")
      const runFiles = await fs.readdir(phaseRunsDir)
      let activeRuns = 0
      let promotedRuns = 0
      for (const file of runFiles) {
        const run = YAML.parse(await Bun.file(path.join(phaseRunsDir, file)).text())
        if (run.status === "active") activeRuns++
        if (run.status === "promoted") promotedRuns++
      }
      // At least 5 promoted (from explore through experiment) and 1 active (compose)
      expect(promotedRuns).toBeGreaterThanOrEqual(5)
      expect(activeRuns).toBeGreaterThanOrEqual(1)

      // The current active run should be in compose
      const activeRun = await readPhaseRun(finalState.focus!.active_phase_run!)
      expect(activeRun.phase).toBe("compose")
      expect(activeRun.status).toBe("active")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 3: Redirect Flow
// ══════════════════════════════════════════════════════════════════════════════

describe("Redirect Flow", () => {
  const TMP = makeTmp("redirect")
  const { callState, readState, readPhaseRun, advanceWithWaive, redirectWithWaive, waiveAllPendingCheckpoints } = makeHelpers(TMP)

  beforeAll(async () => {
    await seedStateMachineProject(TMP)
    // Set up at compose phase so redirect tests have a working state
    const { callState: cs, advanceWithWaive: aw } = makeHelpers(TMP)
    await runWithDirectory(TMP, async () => {
      const phases = ["explore", "ground", "design", "realize", "experiment", "compose"]
      for (const phase of phases) {
        await aw(phase)
      }
    })
  })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("redirect requires reason", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("redirect", { target_phase: "explore" })
      expect(result.output).toContain("reason")
    })
  })

  test("redirect adds pivot_confirmation checkpoint", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("redirect", { target_phase: "explore", reason: "Need to revisit ideas" })
      expect(result.metadata?.status).toBe("pivot_checkpoint_required")

      // Verify the checkpoint was added
      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      const pending = run.human_checkpoints.filter((cp: any) => cp.status === "pending")
      expect(pending.some((cp: any) => cp.kind === "pivot_confirmation")).toBe(true)
    })
  })

  test("redirect blocked by pending checkpoints", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("redirect", { target_phase: "ground", reason: "Try another redirect" })
      expect(result.output).toContain("unresolved checkpoint")
    })
  })

  test("redirect succeeds after pivot checkpoint resolved", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await redirectWithWaive("explore", "Need to revisit ideas")
      expect(result.output).toContain("✅")
      expect(result.output).toContain("Redirected")

      const state = await readState()
      expect(state.focus!.phase).toBe("explore")
    })
  })

  test("redirect creates snapshot with phase.redirected trigger", async () => {
    await runWithDirectory(TMP, async () => {
      // Advance to ground so we can redirect to design
      await advanceWithWaive("ground")

      // Redirect to design
      await redirectWithWaive("design", "Jump ahead for testing snapshot trigger")

      // Check latest snapshot has redirected trigger
      const snapshotDir = path.join(TMP, ".research", "snapshots")
      const entries = await fs.readdir(snapshotDir)
      expect(entries.length).toBeGreaterThan(0)

      const sorted = entries.sort().reverse()
      // Find the most recent snapshot with phase.redirected trigger
      let foundRedirectedSnapshot = false
      for (const entry of sorted) {
        const manifestPath = path.join(snapshotDir, entry, "manifest.yaml")
        const exists = await Bun.file(manifestPath).exists()
        if (!exists) continue
        const manifest = YAML.parse(await Bun.file(manifestPath).text())
        if (manifest.trigger === "phase.redirected") {
          foundRedirectedSnapshot = true
          break
        }
      }
      expect(foundRedirectedSnapshot).toBe(true)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 4: Block/Resume Flow
// ══════════════════════════════════════════════════════════════════════════════

describe("Block/Resume Flow", () => {
  const TMP = makeTmp("block-resume")
  const { callState, readState, readPhaseRun } = makeHelpers(TMP)

  beforeAll(async () => {
    await seedStateMachineProject(TMP)
    // Set up at explore phase so block/resume has a working focus
    const { advanceWithWaive } = makeHelpers(TMP)
    await runWithDirectory(TMP, async () => {
      await advanceWithWaive("explore")
    })
  })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("block requires blocked_on", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("block")
      expect(result.output).toContain("blocked_on")
    })
  })

  test("block sets focus.blocked_on and phase run status", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("block", { blocked_on: "Waiting for GPU allocation" })
      expect(result.output).toContain("blocked")

      const state = await readState()
      expect(state.focus!.blocked_on).toBe("Waiting for GPU allocation")

      const run = await readPhaseRun(state.focus!.active_phase_run!)
      expect(run.status).toBe("blocked")
    })
  })

  test("resume clears blocked_on and restores phase run status", async () => {
    await runWithDirectory(TMP, async () => {
      const result = await callState("resume")
      expect(result.output).toContain("✅")
      expect(result.output).toContain("resumed")

      const state = await readState()
      expect(state.focus!.blocked_on).toBeNull()

      const run = await readPhaseRun(state.focus!.active_phase_run!)
      expect(run.status).toBe("active")
    })
  })

  test("block without focus returns error", async () => {
    await runWithDirectory(TMP, async () => {
      // Clear focus
      const state = await readState()
      if (state.focus) {
        await callState("abort")
      }

      const result = await callState("block", { blocked_on: "Something" })
      expect(result.output).toContain("no focus")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 5: Checkpoint System
// ══════════════════════════════════════════════════════════════════════════════

describe("Checkpoint System", () => {
  const TMP = makeTmp("checkpoint")
  const { callState, readState, readPhaseRun, navigateToPhase } = makeHelpers(TMP)

  beforeAll(async () => { await seedStateMachineProject(TMP) })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("confirm_checkpoint with decision resolves checkpoint", async () => {
    await runWithDirectory(TMP, async () => {
      // Start at explore
      await navigateToPhase("explore")

      // Advance to ground — adds taste_selection
      const first = await callState("advance", { target_phase: "ground" })
      expect(first.metadata?.status).toBe("checkpoints_added")

      // Confirm the checkpoint
      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      const pending = run.human_checkpoints.find((cp: any) => cp.status === "pending" && cp.kind === "taste_selection")
      expect(pending).toBeTruthy()

      const result = await callState("confirm_checkpoint", { checkpoint_kind: "taste_selection", decision: "Idea looks good" })
      expect(result.output).toContain("✅")

      // Verify checkpoint status
      const updatedRun = await readPhaseRun(state.focus!.active_phase_run!)
      const confirmed = updatedRun.human_checkpoints.find((cp: any) => cp.kind === "taste_selection")
      expect(confirmed.status).toBe("confirmed")
      expect(confirmed.decision).toBe("Idea looks good")
    })
  })

  test("waive_checkpoint with reason resolves checkpoint", async () => {
    await runWithDirectory(TMP, async () => {
      // After confirming above, advance should succeed now
      const advanceResult = await callState("advance", { target_phase: "ground" })
      expect(advanceResult.output).toContain("✅")

      // Now advance ground→design — adds taste_selection + reasonableness_check
      const first = await callState("advance", { target_phase: "design" })
      expect(first.metadata?.status).toBe("checkpoints_added")

      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      const pending = run.human_checkpoints.filter((cp: any) => cp.status === "pending")
      expect(pending.length).toBeGreaterThan(0)

      // Waive first pending checkpoint
      const result = await callState("waive_checkpoint", { checkpoint_kind: pending[0].kind, reason: "Test waiver" })
      expect(result.output).toContain("waived")

      const updatedRun = await readPhaseRun(state.focus!.active_phase_run!)
      const waived = updatedRun.human_checkpoints.find((cp: any) => cp.kind === pending[0].kind && cp.status === "waived")
      expect(waived).toBeTruthy()
      expect(waived.waived_reason).toBe("Test waiver")
    })
  })

  test("design→realize adds reasonableness_check + resource_commitment checkpoints", async () => {
    await runWithDirectory(TMP, async () => {
      // Navigate to design
      await navigateToPhase("design")

      // Try design→realize
      const result = await callState("advance", { target_phase: "realize" })
      expect(result.metadata?.status).toBe("checkpoints_added")

      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      const pending = run.human_checkpoints.filter((cp: any) => cp.status === "pending")
      const kinds = pending.map((cp: any) => cp.kind)
      expect(kinds).toContain("reasonableness_check")
      expect(kinds).toContain("resource_commitment")
      expect(pending.length).toBe(2)
    })
  })

  test("experiment→compose adds paper_ambition checkpoint", async () => {
    await runWithDirectory(TMP, async () => {
      // Navigate to experiment
      await navigateToPhase("experiment")

      // Try experiment→compose
      const result = await callState("advance", { target_phase: "compose" })
      expect(result.metadata?.status).toBe("checkpoints_added")

      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      const pending = run.human_checkpoints.filter((cp: any) => cp.status === "pending")
      const kinds = pending.map((cp: any) => cp.kind)
      expect(kinds).toContain("paper_ambition")
      expect(pending.length).toBe(1)
    })
  })

  test("duplicate checkpoint not added", async () => {
    await runWithDirectory(TMP, async () => {
      // Try advancing again — same transition experiment→compose
      // Should be blocked by existing pending checkpoint, not add a duplicate
      const result = await callState("advance", { target_phase: "compose" })
      expect(result.output).toContain("unresolved checkpoint")

      const state = await readState()
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      const paperAmbition = run.human_checkpoints.filter(
        (cp: any) => cp.kind === "paper_ambition" && cp.status === "pending"
      )
      expect(paperAmbition.length).toBe(1)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 6: Inner Loop
// ══════════════════════════════════════════════════════════════════════════════

describe("Inner Loop", () => {
  const TMP = makeTmp("inner-loop")
  const { callState, readState, readPhaseRun, navigateToPhase } = makeHelpers(TMP)

  beforeAll(async () => { await seedStateMachineProject(TMP) })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("inner_loop_transition attempt→evaluate succeeds", async () => {
    await runWithDirectory(TMP, async () => {
      // Navigate to explore — fresh phase run with inner_loop.state = "attempt"
      await navigateToPhase("explore")

      const state = await readState()
      const runBefore = await readPhaseRun(state.focus!.active_phase_run!)
      expect(runBefore.inner_loop.state).toBe("attempt")

      const result = await callState("inner_loop_transition", { target_state: "evaluate" })
      expect(result.output).toContain("✅")

      const runAfter = await readPhaseRun(state.focus!.active_phase_run!)
      expect(runAfter.inner_loop.state).toBe("evaluate")
    })
  })

  test("inner_loop_transition rejects invalid transition", async () => {
    await runWithDirectory(TMP, async () => {
      // Navigate to explore — fresh phase run with inner_loop.state = "attempt"
      await navigateToPhase("explore")

      // attempt → decide is invalid (must go attempt → evaluate → decide)
      try {
        await callState("inner_loop_transition", { target_state: "decide" })
        // If we get here, the transition was not rejected — fail
        expect.unreachable("Expected invalid transition to throw or return error")
      } catch (err: any) {
        expect(err.message).toContain("Invalid inner loop transition")
      }
    })
  })

  test("record_decision iterate increments round", async () => {
    await runWithDirectory(TMP, async () => {
      // Navigate to explore
      await navigateToPhase("explore")

      const state = await readState()
      // Navigate inner loop: attempt → evaluate → decide
      await callState("inner_loop_transition", { target_state: "evaluate" })
      await callState("inner_loop_transition", { target_state: "decide" })

      const runAtDecide = await readPhaseRun(state.focus!.active_phase_run!)
      const roundBefore = runAtDecide.inner_loop.round

      const result = await callState("record_decision", { inner_decision: "iterate", summary: "Need more work" })
      expect(result.output).toContain("✅")

      const runAfter = await readPhaseRun(state.focus!.active_phase_run!)
      expect(runAfter.inner_loop.round).toBe(roundBefore + 1)
      expect(runAfter.inner_loop.state).toBe("attempt")
    })
  })

  test("record_decision promote transitions to terminal state", async () => {
    await runWithDirectory(TMP, async () => {
      // Navigate to explore
      await navigateToPhase("explore")

      const state = await readState()
      // Navigate inner loop: attempt → evaluate → decide
      await callState("inner_loop_transition", { target_state: "evaluate" })
      await callState("inner_loop_transition", { target_state: "decide" })

      const result = await callState("record_decision", { inner_decision: "promote", summary: "Good enough" })
      expect(result.output).toContain("✅")

      const run = await readPhaseRun(state.focus!.active_phase_run!)
      expect(run.inner_loop.state).toBe("promoted")
      expect(run.status).toBe("promoted")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 7: Abort Flow
// ══════════════════════════════════════════════════════════════════════════════

describe("Abort Flow", () => {
  const TMP = makeTmp("abort")
  const { callState, readState, readPhaseRun } = makeHelpers(TMP)

  beforeAll(async () => {
    await seedStateMachineProject(TMP)
    // Start at explore so we have a focus to abort
    const { advanceWithWaive } = makeHelpers(TMP)
    await runWithDirectory(TMP, async () => {
      await advanceWithWaive("explore")
    })
  })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("abort clears focus and marks run as aborted", async () => {
    await runWithDirectory(TMP, async () => {
      // Ensure we have focus
      let state = await readState()
      if (!state.focus) {
        await callState("advance", { target_phase: "explore" })
        state = await readState()
      }

      const runId = state.focus!.active_phase_run!
      const result = await callState("abort")
      expect(result.output).toContain("aborted")

      state = await readState()
      expect(state.focus).toBeUndefined()

      const run = await readPhaseRun(runId)
      expect(run.status).toBe("aborted")
    })
  })

  test("abort without focus returns error", async () => {
    await runWithDirectory(TMP, async () => {
      const state = await readState()
      expect(state.focus).toBeUndefined()

      const result = await callState("abort")
      expect(result.output).toContain("no focus")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 8: Write Order Safety
// ══════════════════════════════════════════════════════════════════════════════

describe("Write Order Safety", () => {
  const TMP = makeTmp("write-order")
  const { callState, readState, readPhaseRun } = makeHelpers(TMP)

  beforeAll(async () => { await seedStateMachineProject(TMP) })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("state.yaml written last on advance", async () => {
    await runWithDirectory(TMP, async () => {
      // Start from explore
      await callState("advance", { target_phase: "explore" })

      const state = await readState()
      expect(state.focus).toBeDefined()
      expect(state.focus!.phase).toBe("explore")
      // Phase run should also exist (written before state.yaml)
      const runExists = await Bun.file(
        path.join(TMP, ".research", "phase_runs", `${state.focus!.active_phase_run}.yaml`)
      ).exists()
      expect(runExists).toBe(true)
    })
  })

  test("state.yaml written last on block", async () => {
    await runWithDirectory(TMP, async () => {
      await callState("block", { blocked_on: "Waiting for data" })

      const state = await readState()
      expect(state.focus!.blocked_on).toBe("Waiting for data")

      // Phase run should also be updated to blocked
      const run = await readPhaseRun(state.focus!.active_phase_run!)
      expect(run.status).toBe("blocked")
    })
  })
})
