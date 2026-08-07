import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { PhaseRunManager } from "../src/phase-run"
import { ResearchFS } from "../src/fs"
import { SnapshotManager } from "../src/snapshot"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import type { PhaseRun, ResourceCommitment } from "../src/schema"

// ── Setup helpers ─────────────────────────────────────────────────────────────

function makeTmp(suffix: string) {
  return path.join(process.env.TMPDIR || "/tmp", `holos-checkpoint-test-${suffix}-${Date.now()}`)
}

async function cleanup(tmp: string) {
  await fs.rm(tmp, { recursive: true, force: true })
}

async function createTestRun(phase: "explore" | "ground" | "design" | "realize" | "experiment" | "compose" = "design"): Promise<string> {
  const run = await PhaseRunManager.create({ phase, summary: "test run" })
  return run!.id
}

// Helper: read the phase run YAML and return parsed object
async function readRunYaml(runId: string): Promise<PhaseRun | undefined> {
  return PhaseRunManager.read(runId)
}

const SAMPLE_RESOURCE_COMMITMENT: ResourceCommitment = {
  resource_spec: {
    gpu_type: "A100",
    gpu_count: 4,
    nodes: 2,
    estimated_gpu_hours: 100,
  },
  connection_method: "inspire",
  budget_approved: false,
}

// ── PhaseRunManager.addCheckpoint tests ───────────────────────────────────────

describe("PhaseRunManager.addCheckpoint", () => {
  const TMP = makeTmp("add")
  beforeAll(async () => { initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any }); await seedProject(TMP, { state: { project: "checkpoint-test" } }) })
  afterAll(async () => { await cleanup(TMP) })

  test("addCheckpoint adds pending checkpoint to run", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "Is this the right idea to pursue?",
      })
      const run = await readRunYaml(runId)
      expect(run?.human_checkpoints.length).toBeGreaterThanOrEqual(1)
      const cp = run!.human_checkpoints.find(c => c.kind === "taste_selection")
      expect(cp).toBeDefined()
      expect(cp!.status).toBe("pending")
      expect(cp!.question).toBe("Is this the right idea to pursue?")
    })
  })

  test("addCheckpoint generates brief", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      const result = await PhaseRunManager.addCheckpoint(runId, {
        kind: "reasonableness_check",
        question: "Is the plan reasonable?",
      })
      const cp = result?.human_checkpoints.find(c => c.kind === "reasonableness_check")
      expect(cp?.brief_ref).toBeTruthy()
      expect(cp?.brief_generated_at).toBeTruthy()
    })
  })

  test("addCheckpoint rejects duplicate pending checkpoint of same kind", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "First question",
      })
      await expect(
        PhaseRunManager.addCheckpoint(runId, {
          kind: "taste_selection",
          question: "Duplicate question",
        }),
      ).rejects.toThrow(/pending checkpoint of this kind already exists/)
    })
  })

  test("addCheckpoint with resource_commitment stores spec", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "resource_commitment",
        question: "Approve GPU allocation?",
        resource_commitment: SAMPLE_RESOURCE_COMMITMENT,
      })
      const run = await readRunYaml(runId)
      const cp = run!.human_checkpoints.find(c => c.kind === "resource_commitment")
      expect(cp?.resource_commitment).toBeDefined()
      expect(cp!.resource_commitment!.resource_spec.gpu_type).toBe("A100")
      expect(cp!.resource_commitment!.resource_spec.gpu_count).toBe(4)
    })
  })

  test("addCheckpoint on non-existent run returns undefined", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await PhaseRunManager.addCheckpoint("run_nonexistent", {
        kind: "taste_selection",
        question: "Does not exist",
      })
      expect(result).toBeUndefined()
    })
  })
})

// ── PhaseRunManager.confirmCheckpoint tests ───────────────────────────────────

describe("PhaseRunManager.confirmCheckpoint", () => {
  const TMP = makeTmp("confirm")
  beforeAll(async () => { initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any }); await seedProject(TMP, { state: { project: "checkpoint-test" } }) })
  afterAll(async () => { await cleanup(TMP) })

  test("confirmCheckpoint sets status to confirmed", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "Is this the right idea?",
      })
      const updated = await PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved", "Looks good")
      const cp = updated?.human_checkpoints.find(c => c.kind === "taste_selection")
      expect(cp?.status).toBe("confirmed")
    })
  })

  test("confirmCheckpoint stores decision and rationale", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "reasonableness_check",
        question: "Is the plan reasonable?",
      })
      const updated = await PhaseRunManager.confirmCheckpoint(
        runId, "reasonableness_check", "confirmed", "The methodology is sound",
      )
      const cp = updated?.human_checkpoints.find(c => c.kind === "reasonableness_check")
      expect(cp?.decision).toBe("confirmed")
      expect(cp?.rationale).toBe("The methodology is sound")
    })
  })

  test("confirmCheckpoint creates snapshot", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "Confirm idea?",
      })

      await PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved")

      // Verify a snapshot with checkpoint.confirmed trigger exists
      const snaps = await SnapshotManager.list()
      const confirmedSnaps = snaps.filter(s => s.trigger === "checkpoint.confirmed")
      expect(confirmedSnaps.length).toBeGreaterThanOrEqual(1)
      // The snapshot should reference the phase run
      expect(confirmedSnaps[confirmedSnaps.length - 1].refs.phase_run).toContain(runId)
    })
  })

  test("confirmCheckpoint rejects already confirmed checkpoint", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "Confirm?",
      })
      await PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved")
      // Confirming again should return undefined (no pending checkpoint of that kind)
      const result = await PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved")
      expect(result).toBeUndefined()
    })
  })
})

// ── PhaseRunManager.waiveCheckpoint tests ─────────────────────────────────────

describe("PhaseRunManager.waiveCheckpoint", () => {
  const TMP = makeTmp("waive")
  beforeAll(async () => { initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any }); await seedProject(TMP, { state: { project: "checkpoint-test" } }) })
  afterAll(async () => { await cleanup(TMP) })

  test("waiveCheckpoint sets status to waived", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "paper_ambition",
        question: "Are we ready to write?",
      })
      const updated = await PhaseRunManager.waiveCheckpoint(runId, "paper_ambition", "Not needed yet")
      const cp = updated?.human_checkpoints.find(c => c.kind === "paper_ambition")
      expect(cp?.status).toBe("waived")
    })
  })

  test("waiveCheckpoint stores waived_reason", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "submission_readiness",
        question: "Ready to submit?",
      })
      const updated = await PhaseRunManager.waiveCheckpoint(
        runId, "submission_readiness", "Need more experiments first",
      )
      const cp = updated?.human_checkpoints.find(c => c.kind === "submission_readiness")
      expect(cp?.waived_reason).toBe("Need more experiments first")
    })
  })

  test("waiveCheckpoint does NOT create snapshot", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "pivot_confirmation",
        question: "Confirm pivot?",
      })

      const idsBefore = new Set((await SnapshotManager.list()).map(s => s.id))

      await PhaseRunManager.waiveCheckpoint(runId, "pivot_confirmation", "No pivot needed")

      const idsAfter = new Set((await SnapshotManager.list()).map(s => s.id))
      const newIds = [...idsAfter].filter(id => !idsBefore.has(id))
      expect(newIds.length).toBe(0)
    })
  })
})

// ── PhaseRunManager.getPendingCheckpoints tests ───────────────────────────────

describe("PhaseRunManager.getPendingCheckpoints", () => {
  const TMP = makeTmp("pending")
  beforeAll(async () => { initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any }); await seedProject(TMP, { state: { project: "checkpoint-test" } }) })
  afterAll(async () => { await cleanup(TMP) })

  test("getPendingCheckpoints returns only pending", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "Idea ok?",
      })
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "reasonableness_check",
        question: "Plan ok?",
      })
      // Confirm one
      await PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved")

      const pending = await PhaseRunManager.getPendingCheckpoints(runId)
      expect(pending.length).toBe(1)
      expect(pending[0].kind).toBe("reasonableness_check")
      expect(pending[0].status).toBe("pending")
    })
  })

  test("getPendingCheckpoints returns empty array for run with no checkpoints", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()
      const pending = await PhaseRunManager.getPendingCheckpoints(runId)
      expect(pending).toEqual([])
    })
  })

  test("getPendingCheckpoints returns empty array for non-existent run", async () => {
    await runWithDirectory(undefined, async () => {
      const pending = await PhaseRunManager.getPendingCheckpoints("run_nonexistent")
      expect(pending).toEqual([])
    })
  })
})

// ── Checkpoint uniqueness enforcement tests ───────────────────────────────────

describe("Checkpoint uniqueness enforcement", () => {
  const TMP = makeTmp("unique")
  beforeAll(async () => { initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any }); await seedProject(TMP, { state: { project: "checkpoint-test" } }) })
  afterAll(async () => { await cleanup(TMP) })

  test("addCheckpoint then confirm then add same kind again works", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()

      // Add and confirm a taste_selection checkpoint
      await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "First idea check",
      })
      await PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved")

      // Adding the same kind again should work (no pending of this kind exists)
      const result = await PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "Second idea check",
      })
      expect(result).toBeDefined()
      const tasteCheckpoints = result!.human_checkpoints.filter(c => c.kind === "taste_selection")
      expect(tasteCheckpoints.length).toBe(2)
      // First is confirmed, second is pending
      expect(tasteCheckpoints[0].status).toBe("confirmed")
      expect(tasteCheckpoints[1].status).toBe("pending")
    })
  })

  test("addCheckpoint while pending of same kind exists throws", async () => {
    await runWithDirectory(undefined, async () => {
      const runId = await createTestRun()

      await PhaseRunManager.addCheckpoint(runId, {
        kind: "resource_commitment",
        question: "Approve resources?",
        resource_commitment: SAMPLE_RESOURCE_COMMITMENT,
      })

      // Trying to add the same kind while pending should throw
      await expect(
        PhaseRunManager.addCheckpoint(runId, {
          kind: "resource_commitment",
          question: "Another resource request?",
        }),
      ).rejects.toThrow(/pending checkpoint of this kind already exists/)
    })
  })
})
