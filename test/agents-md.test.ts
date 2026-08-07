import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import {
  generateAgentsMd,
  generateDynamicSection,
  updateAgentsMdDynamic,
} from "../src/tools/agents-md"
import { appendNotes, lineageWarning } from "../src/tools/shared"
import type { StateYaml, TimelineEvent } from "../src/schema"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-test-agents-md-${Date.now()}`)

function stubAccessor() { return { get: async () => ({}), set: async () => {} } }
function stubAuth() { return { get: async () => undefined, set: async () => {}, delete: async () => {}, has: async () => false } }
function stubCache() { return { get: async () => undefined, set: async () => {}, delete: async () => {}, directory: "/tmp" } }

function makeState(overrides: Partial<StateYaml> = {}): StateYaml {
  return {
    project: "Test Project",
    anchor: "Explore factorized gaps in diffusion",
    created: "2026-01-01T00:00:00Z",
    updated: "2026-05-06T12:00:00Z",
    config: {
      participation_mode: "collaborative",
      venue: "ICML 2027",
      stalled_days: 7,
      exploration: { depth: "standard", pilot: "enabled", max_refine_rounds: 3, idea_select_score: 8, idea_generators: 3 },
      ground: { max_review_rounds: 2, max_closest_works: 3 },
      design: { max_review_rounds: 5, score_threshold: 7, max_primary_claims: 2, max_new_components: 2 },
      experiment: { max_optimize_rounds: 3, monitor_interval: "30m", significance_level: 0.05, min_seeds: 3, regression_tolerance: 0.05 },
      realize: { max_review_rounds: 3, code_review_threshold: 7, require_sanity_contract: true, require_quality_contract: true },
      compose: { max_revise_rounds: 3 },
    },
    counters: { idea: 5, plan: 2, exp: 12, claim: 3, exh: 1, paper: 0, sub: 0 },
    focus: {
      since: "2026-05-01T00:00:00Z",
      phase: "experiment",
      summary: "Running main experiments",
      reason: "Plan approved and activated",
      blocked_on: null,
      next: "Collect exp_010 results",
      refs: { idea_ref: "idea_003", plan_ref: "plan_002", experiment_refs: ["exp_010", "exp_011"] },
    },
    ...overrides,
  }
}

function makeEvents(count: number): TimelineEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: `2026-05-0${Math.min(i + 1, 9)}T10:00:00Z`,
    type: `exp.status`,
    id: `exp_${String(i + 1).padStart(3, "0")}`,
    summary: `Experiment ${i + 1} completed`,
  }))
}

async function setupTmp() {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await fs.mkdir(path.join(TMP, ".research", "experiments"), { recursive: true })
  await fs.mkdir(path.join(TMP, ".research", "ideas"), { recursive: true })
  await fs.mkdir(path.join(TMP, ".research", "plans"), { recursive: true })
  await fs.mkdir(path.join(TMP, ".research", "claims"), { recursive: true })
}

afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

// ══════════════════════════════════════════════════════════════════════════════
// agents-md.ts — Dynamic section generation
// ══════════════════════════════════════════════════════════════════════════════

describe("generateDynamicSection", () => {
  test("handles complete state with all fields", () => {
    const state = makeState()
    const events = makeEvents(3)
    const result = generateDynamicSection(state, events)

    expect(result).toContain("**Project**: Test Project")
    expect(result).toContain("**Anchor**: Explore factorized gaps")
    expect(result).toContain("**Current Phase**: experiment")
    expect(result).toContain("**Focus**: Running main experiments")
    expect(result).toContain("**Next Step**: Collect exp_010 results")
    expect(result).toContain("Idea: idea_003")
    expect(result).toContain("Plan: plan_002")
    expect(result).toContain("Experiments: exp_010, exp_011")
    expect(result).toContain("### Recent Activity")
  })

  test("handles state with no focus (null)", () => {
    const state = makeState({ focus: undefined })
    const result = generateDynamicSection(state, [])

    expect(result).toContain("**Current Phase**: (not set)")
    expect(result).not.toContain("undefined")
    expect(result).not.toContain("null")
  })

  test("handles state with blocked_on", () => {
    const state = makeState()
    state.focus!.blocked_on = "Waiting for GPU quota reset"
    const result = generateDynamicSection(state, [])

    expect(result).toContain("⚠ BLOCKED")
    expect(result).toContain("Waiting for GPU quota reset")
  })

  test("handles empty events array", () => {
    const state = makeState()
    const result = generateDynamicSection(state, [])

    expect(result).not.toContain("### Recent Activity")
  })

  test("truncates to last 10 events when given more", () => {
    const state = makeState()
    const events = makeEvents(25)
    const result = generateDynamicSection(state, events)

    // Should only show last 10
    const activityLines = result.split("\n").filter(l => l.startsWith("- `"))
    expect(activityLines.length).toBe(10)
  })

  test("handles missing optional fields without crashing", () => {
    const state = makeState({
      anchor: undefined,
      focus: {
        since: "2026-01-01T00:00:00Z",
        phase: "explore",
        blocked_on: null,
        // no summary, no reason, no next, no refs
      },
    })
    const result = generateDynamicSection(state, [])

    expect(result).toContain("**Anchor**: (not set)")
    expect(result).toContain("**Current Phase**: explore")
    expect(result).not.toContain("undefined")
  })

  test("handles venue not set", () => {
    const state = makeState()
    state.config.venue = undefined
    const result = generateDynamicSection(state, [])

    expect(result).toContain("**Target Venue**: (not set)")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// agents-md.ts — updateAgentsMdDynamic marker handling
// ══════════════════════════════════════════════════════════════════════════════

describe("updateAgentsMdDynamic", () => {
  const MARKER_START = "<!-- DYNAMIC_STATE_START -->"
  const MARKER_END = "<!-- DYNAMIC_STATE_END -->"

  test("correctly replaces dynamic section between markers", () => {
    const existing = [
      "# My Project",
      "",
      MARKER_START,
      "old content here",
      MARKER_END,
      "",
      "## Static Rules",
      "some rules",
    ].join("\n")

    const state = makeState()
    const result = updateAgentsMdDynamic(existing, state, [])!

    expect(result).toContain("# My Project")
    expect(result).toContain("## Static Rules")
    expect(result).toContain("**Project**: Test Project")
    expect(result).not.toContain("old content here")
  })

  test("returns null when start marker is missing", () => {
    const existing = "# No markers here\n\nJust plain content"
    const result = updateAgentsMdDynamic(existing, makeState(), [])
    expect(result).toBeNull()
  })

  test("returns null when end marker is missing", () => {
    const existing = `# Title\n${MARKER_START}\nsome stuff\n`
    const result = updateAgentsMdDynamic(existing, makeState(), [])
    expect(result).toBeNull()
  })

  test("returns null when markers are in reversed order", () => {
    const existing = `# Title\n${MARKER_END}\nstuff\n${MARKER_START}\n`
    const result = updateAgentsMdDynamic(existing, makeState(), [])
    expect(result).toBeNull()
  })

  test("preserves content before start marker exactly", () => {
    const header = "# Project Title\n\n> Auto-managed\n\n"
    const existing = header + MARKER_START + "\nold\n" + MARKER_END + "\n## Rules"
    const result = updateAgentsMdDynamic(existing, makeState(), [])!

    expect(result.startsWith(header)).toBe(true)
  })

  test("preserves content after end marker exactly", () => {
    const footer = "\n\n## Static Rules\n\nNever delete code.\n"
    const existing = MARKER_START + "\nold\n" + MARKER_END + footer
    const result = updateAgentsMdDynamic(existing, makeState(), [])!

    expect(result.endsWith(footer)).toBe(true)
  })

  test("handles empty content between markers", () => {
    const existing = `${MARKER_START}\n${MARKER_END}\n## Rules`
    const result = updateAgentsMdDynamic(existing, makeState(), [])!

    expect(result).toContain("**Project**: Test Project")
    expect(result).toContain("## Rules")
  })

  test("handles markers on same line (degenerate but valid)", () => {
    const existing = `Before\n${MARKER_START}${MARKER_END}\nAfter`
    const result = updateAgentsMdDynamic(existing, makeState(), [])!

    expect(result).toContain("Before\n")
    expect(result).toContain("\nAfter")
    expect(result).toContain("**Project**: Test Project")
  })

  test("idempotent — multiple updates produce consistent output", () => {
    const state = makeState()
    const events = makeEvents(3)

    const initial = generateAgentsMd(state)
    const updated1 = updateAgentsMdDynamic(initial, state, events)!
    const updated2 = updateAgentsMdDynamic(updated1, state, events)!

    expect(updated1).toBe(updated2)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// agents-md.ts — Full generation
// ══════════════════════════════════════════════════════════════════════════════

describe("generateAgentsMd", () => {
  test("contains both markers", () => {
    const result = generateAgentsMd(makeState())
    expect(result).toContain("<!-- DYNAMIC_STATE_START -->")
    expect(result).toContain("<!-- DYNAMIC_STATE_END -->")
  })

  test("contains static rules section", () => {
    const result = generateAgentsMd(makeState())
    expect(result).toContain("Session Startup Checklist")
    expect(result).toContain("Git Discipline")
    expect(result).toContain("Code Quality Standards")
    expect(result).toContain("Directory Structure")
    expect(result).toContain("Workflow Triggers")
    expect(result).toContain("Research Trail Integrity")
  })

  test("dynamic section appears before static rules", () => {
    const result = generateAgentsMd(makeState())
    const dynamicIdx = result.indexOf("## Current Research State")
    const staticIdx = result.indexOf("## Critical Operating Rules")
    expect(dynamicIdx).toBeLessThan(staticIdx)
  })

  test("project title is in the header", () => {
    const state = makeState({ project: "Factorized Gap Analysis" })
    const result = generateAgentsMd(state)
    expect(result).toContain("# Factorized Gap Analysis")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// shared.ts — appendNotes
// ══════════════════════════════════════════════════════════════════════════════

describe("appendNotes", () => {
  beforeAll(setupTmp)

  test("creates .md if it does not exist", async () => {
    await runWithDirectory(TMP, async () => {
      await appendNotes("experiments", "exp_999", "Complete", "First result captured.")
      const content = await Bun.file(path.join(TMP, ".research", "experiments", "exp_999.md")).text()

      expect(content).toContain("## Complete —")
      expect(content).toContain("First result captured.")
    })
  })

  test("appends to existing content without overwriting", async () => {
    await runWithDirectory(TMP, async () => {
      const mdPath = path.join(TMP, ".research", "experiments", "exp_append.md")
      await Bun.write(mdPath, "## Notes\n\nInitial observations.\n")

      await appendNotes("experiments", "exp_append", "Complete", "Final metrics: acc=0.85")
      const content = await Bun.file(mdPath).text()

      expect(content).toContain("Initial observations.")
      expect(content).toContain("## Complete —")
      expect(content).toContain("Final metrics: acc=0.85")
    })
  })

  test("multiple appends accumulate chronologically", async () => {
    await runWithDirectory(TMP, async () => {
      const mdPath = path.join(TMP, ".research", "experiments", "exp_multi.md")
      await Bun.write(mdPath, "## Notes\n\nSetup done.\n")

      await appendNotes("experiments", "exp_multi", "Start", "Job submitted to GPU cluster.")
      await appendNotes("experiments", "exp_multi", "Complete", "Converged at epoch 15.")
      await appendNotes("experiments", "exp_multi", "Analysis", "Beat baseline by 3.2pp.")

      const content = await Bun.file(mdPath).text()
      const sections = content.split("---").length - 1
      expect(sections).toBe(3) // Three appended sections

      // Order preserved
      const startIdx = content.indexOf("Job submitted")
      const completeIdx = content.indexOf("Converged at epoch")
      const analysisIdx = content.indexOf("Beat baseline")
      expect(startIdx).toBeLessThan(completeIdx)
      expect(completeIdx).toBeLessThan(analysisIdx)
    })
  })

  test("handles notes containing markdown separators (---)", async () => {
    await runWithDirectory(TMP, async () => {
      await appendNotes("experiments", "exp_sep", "Complete", "Results:\n---\nMetric | Value\nacc | 0.9\n---")
      const content = await Bun.file(path.join(TMP, ".research", "experiments", "exp_sep.md")).text()

      // The content should be there verbatim — we don't escape user content
      expect(content).toContain("Metric | Value")
      expect(content).toContain("acc | 0.9")
    })
  })

  test("timestamp format is ISO without milliseconds", async () => {
    await runWithDirectory(TMP, async () => {
      await appendNotes("ideas", "idea_ts", "Select", "Chosen as primary direction.")
      const content = await Bun.file(path.join(TMP, ".research", "ideas", "idea_ts.md")).text()

      // Match pattern: ## Select — 2026-05-06T21:30:00Z
      const match = content.match(/## Select — (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/)
      expect(match).not.toBeNull()
      expect(match![1].length).toBe(20) // "2026-05-06T21:30:00Z"
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// shared.ts — lineageWarning
// ══════════════════════════════════════════════════════════════════════════════

describe("lineageWarning", () => {
  test("experiment with no plan and no idea produces warning", () => {
    const result = lineageWarning("experiment", { title: "Test" })
    expect(result).toContain("plan")
    expect(result).toContain("idea")
    expect(result).toContain("⚠️")
  })

  test("experiment with plan and idea produces no warning", () => {
    const result = lineageWarning("experiment", { plan_ref: "plan_001", idea_ref: "idea_003" })
    expect(result).toBe("")
  })

  test("experiment with only plan still warns about idea", () => {
    const result = lineageWarning("experiment", { plan_ref: "plan_001" })
    expect(result).toContain("idea")
    expect(result).not.toContain("plan")
  })

  test("plan with no idea produces warning", () => {
    const result = lineageWarning("plan", { title: "Some plan" })
    expect(result).toContain("idea")
  })

  test("plan with idea produces no warning", () => {
    const result = lineageWarning("plan", { idea: "idea_003" })
    expect(result).toBe("")
  })

  test("claim with empty evidence array produces warning", () => {
    const result = lineageWarning("claim", { evidence: [] })
    expect(result).toContain("evidence")
  })

  test("claim with evidence produces no warning", () => {
    const result = lineageWarning("claim", { evidence: [{ ref: "exp_001" }] })
    expect(result).toBe("")
  })

  test("claim with undefined evidence produces warning", () => {
    const result = lineageWarning("claim", { title: "Some claim" })
    expect(result).toContain("evidence")
  })

  test("unknown entity type produces no warning", () => {
    const result = lineageWarning("exhibit", {})
    expect(result).toBe("")
  })

  test("undefined params don't crash", () => {
    const result = lineageWarning("experiment", {})
    expect(result).toContain("⚠️")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Integration: AGENTS.md survives repeated brief cycles
// ══════════════════════════════════════════════════════════════════════════════

describe("AGENTS.md lifecycle integration", () => {
  test("generate → update → update produces valid output each time", () => {
    const state = makeState()

    // Initial generation
    const gen = generateAgentsMd(state)
    expect(gen).toContain("<!-- DYNAMIC_STATE_START -->")
    expect(gen).toContain("<!-- DYNAMIC_STATE_END -->")

    // First brief update
    state.focus!.phase = "compose"
    state.focus!.summary = "Extracting claims from results"
    const events1 = makeEvents(5)
    const updated1 = updateAgentsMdDynamic(gen, state, events1)!
    expect(updated1).not.toBeNull()
    expect(updated1).toContain("compose")
    expect(updated1).toContain("Extracting claims")
    // Dynamic section no longer shows "experiment" as the phase
    expect(updated1).toContain("**Current Phase**: compose")

    // Static rules still intact
    expect(updated1).toContain("Git Discipline")
    expect(updated1).toContain("Session Startup Checklist")

    // Second brief update
    state.focus!.blocked_on = "Waiting for reviewer feedback"
    const events2 = [...events1, ...makeEvents(3)]
    const updated2 = updateAgentsMdDynamic(updated1, state, events2)!
    expect(updated2).toContain("⚠ BLOCKED")
    expect(updated2).toContain("Waiting for reviewer feedback")
    expect(updated2).toContain("Git Discipline") // Static still there
  })

  test("corrupted AGENTS.md (markers removed) triggers null → full regen", () => {
    const state = makeState()
    const gen = generateAgentsMd(state)

    // Simulate user manually editing and accidentally deleting markers
    const corrupted = gen.replace("<!-- DYNAMIC_STATE_START -->", "").replace("<!-- DYNAMIC_STATE_END -->", "")
    const result = updateAgentsMdDynamic(corrupted, state, [])

    // Should return null — caller is responsible for full regeneration
    expect(result).toBeNull()
  })

  test("AGENTS.md with extra markers (duplicated) uses first pair", () => {
    const state = makeState()
    const MARKER_START = "<!-- DYNAMIC_STATE_START -->"
    const MARKER_END = "<!-- DYNAMIC_STATE_END -->"

    // Construct content with duplicated markers (e.g. from a paste error)
    const content = [
      "# Title",
      MARKER_START,
      "first",
      MARKER_END,
      "## Middle",
      MARKER_START,
      "second",
      MARKER_END,
      "## End",
    ].join("\n")

    const result = updateAgentsMdDynamic(content, state, [])!
    // indexOf finds the FIRST occurrence, so it replaces between first start and first end
    expect(result).toContain("# Title")
    expect(result).toContain("**Project**: Test Project")
    // Content after first end marker (including second pair) is preserved as-is
    expect(result).toContain("## Middle")
  })
})
