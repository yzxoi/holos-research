import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { computeSubmit } from "../src/tools/compute"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import type { ToolContext, ToolResult } from "@ericsanchezok/synergy-plugin/tool"
import type { StateYaml } from "../src/schema"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Helpers ───────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-phase-gate-${Date.now()}`)

const stubCtx: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test",
  abort: new AbortController().signal,
}

async function seedPhaseProject(phase?: string) {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  const stateOverrides: Record<string, unknown> = {
    project: "phase-gate-test",
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
  }
  if (phase) {
    stateOverrides.focus = {
      phase: phase,
      since: new Date().toISOString(),
      refs: {},
      active_phase_run: `pr_${phase}_001`,
    }
  }
  await seedProject(TMP, { state: stateOverrides })
}

async function callCompute(params: Record<string, any> = {}): Promise<ToolResult> {
  return computeSubmit.execute({
    mode: "distributed",
    name: "test-job",
    workspace: "test-ws",
    compute_group: "4090",
    image: "test-image",
    command: "echo hello",
    ...params,
  } as any, stubCtx) as Promise<ToolResult>
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await fs.mkdir(TMP, { recursive: true })
  await seedPhaseProject()
})

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {})
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("compute_submit phase gate", () => {
  test("blocks compute_submit in realize phase", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("realize")
      const result = await callCompute()
      expect(result.title).toContain("Phase boundary violation")
      expect(result.metadata).toMatchObject({ error: "phase_boundary_violation", current_phase: "realize" })
    })
  })

  test("blocks compute_submit in design phase", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("design")
      const result = await callCompute()
      expect(result.title).toContain("Phase boundary violation")
      expect(result.metadata).toMatchObject({ error: "phase_boundary_violation", current_phase: "design" })
    })
  })

  test("blocks compute_submit in explore phase", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("explore")
      const result = await callCompute()
      expect(result.title).toContain("Phase boundary violation")
      expect(result.metadata).toMatchObject({ error: "phase_boundary_violation", current_phase: "explore" })
    })
  })

  test("allows compute_submit in experiment phase", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment")
      const result = await callCompute()
      // Should NOT be blocked by phase gate — will fail with compute kit unavailable instead
      expect(result.title).not.toContain("Phase boundary violation")
      expect(result.metadata?.error).not.toBe("phase_boundary_violation")
    })
  })

  test("allows compute_submit when no phase is set", async () => {
    await runWithDirectory(TMP, async () => {
      // No focus.phase in state.yaml
      await seedPhaseProject()
      const result = await callCompute()
      // Should NOT be blocked — no phase means no restriction
      expect(result.title).not.toContain("Phase boundary violation")
      expect(result.metadata?.error).not.toBe("phase_boundary_violation")
    })
  })
})
