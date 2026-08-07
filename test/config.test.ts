import { describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { ResearchTimeline } from "../src/timeline"
import { researchState } from "../src/tools/state"
import { researchInit } from "../src/tools/init"
import { stubAccessor, stubAuth, stubCache, stubCtx } from "./helpers"
import type { ToolResult } from "@ericsanchezok/synergy-plugin"
import type { StateYaml } from "../src/schema"
import {
  ExplorationConfig, GroundConfig, DesignConfig, RealizeConfig, ExperimentConfig,
  ComposeConfig, StateYaml as StateYamlSchema,
} from "../src/schema"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir(label: string) {
  return path.join(process.env.TMPDIR || "/tmp", `holos-config-test-${label}-${Date.now()}`)
}

async function callState(params: Record<string, any>) {
  return researchState.execute(params as any, stubCtx) as Promise<ToolResult>
}

/** Write a raw state.yaml to disk, bypassing schema validation */
async function writeRawState(dir: string, raw: Record<string, any>) {
  const rd = path.join(dir, ".research")
  await fs.mkdir(rd, { recursive: true })
  for (const sub of ["ideas", "plans", "experiments", "claims", "exhibits", "manuscripts", "submissions", "literature"]) {
    await fs.mkdir(path.join(rd, sub), { recursive: true })
  }
  await Bun.write(path.join(rd, "state.yaml"), YAML.stringify(raw))
  await Bun.write(path.join(rd, "timeline.jsonl"), "")
}

/** Read state.yaml back from disk as raw object */
async function readRawState(dir: string): Promise<Record<string, any>> {
  const content = await Bun.file(path.join(dir, ".research", "state.yaml")).text()
  return YAML.parse(content)
}

// =============================================================================
// 1. BACKWARD COMPATIBILITY — old state.yaml files missing new config fields
// =============================================================================

describe("Config backward compat: old state files", () => {
  const TMP = tmpDir("compat")

  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("state.yaml with only exploration config → all phase configs get defaults", async () => {
    // Simulate a pre-config-system state.yaml
    await writeRawState(TMP, {
      project: "old-project",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      config: {
        participation_mode: "collaborative",
        exploration: { depth: "thorough", pilot: "skip" },
        // NO ground, design, experiment, compose, realize, stalled_days
      },
      counters: { idea: 3, plan: 1, exp: 5, claim: 2, exh: 1, paper: 0, sub: 0 },
      focus: {
        since: "2026-01-15T00:00:00Z",
        phase: "experiment",
        summary: "Running experiments",
      },
    })

    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
    await runWithDirectory(undefined, async () => {
      const result = await callState({ action: "read" })
      const state = result.metadata!.state as StateYaml

      // Old fields preserved
      expect(state.config.exploration.depth).toBe("thorough")
      expect(state.config.exploration.pilot).toBe("skip")

      // New exploration fields get defaults
      expect(state.config.exploration.max_refine_rounds).toBe(3)
      expect(state.config.exploration.idea_select_score).toBe(8)

      // Entirely new phase configs get defaults
      expect(state.config.design.max_review_rounds).toBe(5)
      expect(state.config.experiment.max_optimize_rounds).toBe(3)
      expect(state.config.realize.max_review_rounds).toBe(3)
      expect(state.config.stalled_days).toBe(7)
    })
  })

  test("state.yaml with NO config section at all → still parses", async () => {
    await writeRawState(TMP, {
      project: "ancient-project",
      created: "2025-06-01T00:00:00Z",
      updated: "2025-06-01T00:00:00Z",
      // config missing entirely — Zod should provide top-level default
      counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
    })

    await runWithDirectory(undefined, async () => {
      // This tests whether readYaml + Zod parse handles missing config gracefully.
      // The tool calls readYaml which does YAML.parse only (no Zod),
      // so we test the Zod schema separately.
      const raw = await readRawState(TMP)
      const parsed = StateYamlSchema.safeParse(raw)
      // This WILL fail because config is required in the schema (no .default() on config itself)
      // This is the expected behavior — config is required at the StateYaml level
      expect(parsed.success).toBe(false)
    })
  })
})

// =============================================================================
// 2. DEEP MERGE — phase_config update correctness
// =============================================================================

describe("Config deep merge via phase_config", () => {
  const TMP = tmpDir("merge")

  beforeAll(async () => {
    await writeRawState(TMP, {
      project: "merge-test",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      config: {
        participation_mode: "collaborative",
        stalled_days: 7,
        exploration: ExplorationConfig.parse({}),
        ground: GroundConfig.parse({}),
        design: DesignConfig.parse({}),
        experiment: ExperimentConfig.parse({}),
        compose: ComposeConfig.parse({}),
        realize: RealizeConfig.parse({}),
      },
      counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
      focus: { since: "2026-01-01T00:00:00Z", phase: "explore" },
    })
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("partial design update preserves other design fields", async () => {
    await runWithDirectory(undefined, async () => {
      await callState({ action: "read", phase_config: { design: { max_review_rounds: 8 } } })
      const state = (await callState({ action: "read" })).metadata!.state as StateYaml

      expect(state.config.design.max_review_rounds).toBe(8) // changed
      expect(state.config.design.score_threshold).toBe(7)    // untouched
      expect(state.config.design.max_primary_claims).toBe(2)  // untouched
      expect(state.config.design.max_new_components).toBe(2)  // untouched
    })
  })

  test("updating design config does NOT affect exploration config", async () => {
    await runWithDirectory(undefined, async () => {
      await callState({ action: "read", phase_config: { design: { score_threshold: 9 } } })
      const state = (await callState({ action: "read" })).metadata!.state as StateYaml

      expect(state.config.design.score_threshold).toBe(9)
      expect(state.config.exploration.depth).toBe("standard") // untouched
      expect(state.config.exploration.max_refine_rounds).toBe(3) // untouched
    })
  })

  test("falsy value: require_sanity_contract=false is preserved, not swallowed", async () => {
    await runWithDirectory(undefined, async () => {
      // This is a critical edge case: Object.assign should keep false, not skip it
      await callState({ action: "read", phase_config: { realize: { require_sanity_contract: false } } })
      const state = (await callState({ action: "read" })).metadata!.state as StateYaml

      expect(state.config.realize.require_sanity_contract).toBe(false)
      expect(state.config.realize.code_review_threshold).toBe(7) // untouched
    })
  })

  test("falsy value: stalled_days=0 is preserved", async () => {
    await runWithDirectory(undefined, async () => {
      await callState({ action: "read", phase_config: { stalled_days: 0 } })
      const state = (await callState({ action: "read" })).metadata!.state as StateYaml

      expect(state.config.stalled_days).toBe(0)
    })
  })

  test("empty phase object {} does not clobber existing values", async () => {
    await runWithDirectory(undefined, async () => {
      // First set a non-default value
      await callState({ action: "read", phase_config: { realize: { code_review_threshold: 9 } } })
      // Then pass empty realize object
      await callState({ action: "read", phase_config: { realize: {} } })
      const state = (await callState({ action: "read" })).metadata!.state as StateYaml

      expect(state.config.realize.code_review_threshold).toBe(9) // should NOT reset to default
    })
  })

  test("multiple sequential updates accumulate correctly", async () => {
    await runWithDirectory(undefined, async () => {
      await callState({ action: "read", phase_config: { experiment: { max_optimize_rounds: 5 } } })
      await callState({ action: "read", phase_config: { experiment: { monitor_interval: "1h" } } })
      await callState({ action: "read", phase_config: { experiment: { min_seeds: 5 } } })

      const state = (await callState({ action: "read" })).metadata!.state as StateYaml
      expect(state.config.experiment.max_optimize_rounds).toBe(5) // from first update
      expect(state.config.experiment.monitor_interval).toBe("1h") // from second
      expect(state.config.experiment.min_seeds).toBe(5)            // from third
      expect(state.config.experiment.significance_level).toBe(0.05) // never touched, stays default
    })
  })

  test("multi-phase update in single call", async () => {
    await runWithDirectory(undefined, async () => {
      await callState({
        action: "read",
        phase_config: {
          exploration: { idea_generators: 5 },
          ground: { max_closest_works: 5 },
          compose: { max_revise_rounds: 5 },
        },
      })
      const state = (await callState({ action: "read" })).metadata!.state as StateYaml
      expect(state.config.exploration.idea_generators).toBe(5)
      expect(state.config.ground.max_closest_works).toBe(5)
      expect(state.config.compose.max_revise_rounds).toBe(5)
    })
  })
})

// =============================================================================
// 3. PERSISTENCE ROUNDTRIP — config survives write → read via YAML
// =============================================================================

describe("Config persistence roundtrip", () => {
  const TMP = tmpDir("roundtrip")

  beforeAll(async () => {
    await writeRawState(TMP, {
      project: "roundtrip-test",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      config: {
        participation_mode: "autonomous",
        stalled_days: 14,
        exploration: ExplorationConfig.parse({ depth: "thorough", idea_generators: 5 }),
        ground: GroundConfig.parse({ max_closest_works: 5 }),
        design: DesignConfig.parse({ score_threshold: 9 }),
        experiment: ExperimentConfig.parse({ significance_level: 0.01 }),
        compose: ComposeConfig.parse({ max_revise_rounds: 5 }),
        realize: RealizeConfig.parse({ code_review_threshold: 9 }),
      },
      counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
      focus: { since: "2026-01-01T00:00:00Z", phase: "explore" },
    })
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("non-default values survive YAML serialization roundtrip", async () => {
    await runWithDirectory(undefined, async () => {
      // Trigger a write by updating something
      await callState({ action: "read", phase_config: { stalled_days: 14 } })

      // Read back from disk directly (bypass any caching)
      const raw = await readRawState(TMP)

      expect(raw.config.participation_mode).toBe("autonomous")
      expect(raw.config.stalled_days).toBe(14)
      expect(raw.config.exploration.depth).toBe("thorough")
      expect(raw.config.exploration.idea_generators).toBe(5)
      expect(raw.config.realize.code_review_threshold).toBe(9)
      expect(raw.config.design.score_threshold).toBe(9)
      expect(raw.config.experiment.significance_level).toBe(0.01)
      expect(raw.config.compose.max_revise_rounds).toBe(5)
    })
  })

  test("YAML roundtrip preserves float precision (significance_level: 0.01)", async () => {
    await runWithDirectory(undefined, async () => {
      const raw = await readRawState(TMP)
      // YAML can mangle floats. Verify 0.01 didn't become 0.010000000000000002
      expect(raw.config.experiment.significance_level).toBe(0.01)
      expect(raw.config.experiment.regression_tolerance).toBe(0.05)
    })
  })
})

// =============================================================================
// 4. SCHEMA EDGE CASES — invalid and extreme values
// =============================================================================

describe("Config schema edge cases", () => {
  test("negative max_review_rounds is accepted by schema (no min validation)", () => {
    // This documents current behavior: schema does NOT enforce min values.
    // If we want validation, we need to add .min() to the schema.
    const result = DesignConfig.safeParse({ max_review_rounds: -1 })
    expect(result.success).toBe(true)
    // This test is intentionally documenting a gap, not asserting it's good behavior.
    // TODO: Consider adding .min(1) to numeric config fields.
  })

  test("string where number expected is rejected", () => {
    const result = DesignConfig.safeParse({ max_review_rounds: "five" })
    expect(result.success).toBe(false)
  })

  test("number coerced from YAML string-like: '5' as a raw number passes", () => {
    // In YAML, `max_review_rounds: 5` parses as number, not string.
    // But `max_review_rounds: "5"` would parse as string. Zod should reject.
    const result = DesignConfig.safeParse({ max_review_rounds: "5" })
    expect(result.success).toBe(false) // strict number, no coercion
  })

  test("unknown extra fields in config are stripped (Zod strip mode)", () => {
    const result = DesignConfig.safeParse({
      max_review_rounds: 3,
      unknown_field: "surprise",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as any).unknown_field).toBeUndefined()
    }
  })

  test("ExplorationConfig rejects invalid depth enum", () => {
    const result = ExplorationConfig.safeParse({ depth: "extreme" })
    expect(result.success).toBe(false)
  })

  test("ExplorationConfig rejects invalid pilot enum", () => {
    const result = ExplorationConfig.safeParse({ pilot: "maybe" })
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// 5. FORMAT OUTPUT — config is visible in state read output
// =============================================================================

describe("Config appears in formatted state output", () => {
  const TMP = tmpDir("format")

  beforeAll(async () => {
    await writeRawState(TMP, {
      project: "format-test",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      config: {
        participation_mode: "guided",
        stalled_days: 14,
        exploration: ExplorationConfig.parse({ depth: "thorough" }),
        ground: GroundConfig.parse({}),
        design: DesignConfig.parse({ score_threshold: 9 }),
        experiment: ExperimentConfig.parse({}),
        compose: ComposeConfig.parse({}),
        realize: RealizeConfig.parse({}),
      },
      counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
      focus: { since: "2026-01-01T00:00:00Z", phase: "explore" },
    })
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("read output shows phase config section", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callState({ action: "read" })
      expect(result.output).toContain("Phase Config:")
      expect(result.output).toContain("score_threshold=9")
      expect(result.output).toContain("depth=thorough")
      expect(result.output).toContain("Mode: guided")
    })
  })

  test("non-default values are visible in output (agent can read them)", async () => {
    await runWithDirectory(undefined, async () => {
      await callState({ action: "read", phase_config: { experiment: { monitor_interval: "2h" } } })
      const result = await callState({ action: "read" })
      expect(result.output).toContain("monitor_interval=2h")
    })
  })
})
