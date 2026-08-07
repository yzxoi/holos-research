import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { PhaseRunManager } from "../src/phase-run"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import {
  gatherCheckpointContext,
  generateMarkdownBrief,
  generateAndSaveBrief,
  readBrief,
  type CheckpointContext,
} from "../src/checkpoint-context"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import type { PhaseRun } from "../src/schema"

// ── Setup helpers ─────────────────────────────────────────────────────────────

function makeTmp(suffix: string) {
  return path.join(process.env.TMPDIR || "/tmp", `holos-ctx-cp-test-${suffix}-${Date.now()}`)
}

async function cleanup(tmp: string) {
  await fs.rm(tmp, { recursive: true, force: true })
}

async function createTestRun(
  phase: "explore" | "ground" | "design" | "realize" | "experiment" | "compose" = "design",
): Promise<string> {
  const run = await PhaseRunManager.create({ phase, summary: "test run" })
  return run!.id
}

/** Minimal CheckpointContext for unit-testing generateMarkdownBrief in isolation. */
function makeMinimalContext(overrides: Partial<CheckpointContext> = {}): CheckpointContext {
  return {
    project: "test-project",
    anchor: null,
    venue: null,
    generatedAt: "2026-05-15T12:00:00.000Z",
    checkpointKind: "taste_selection",
    checkpointQuestion: "Is this the right idea?",
    phaseRunId: "run_20260515_test",
    currentPhase: "explore",
    sinceTimestamp: null,
    sinceLabel: "(project start — first checkpoint of this kind)",
    timelineEvents: [],
    journalNotes: [],
    humanDecisions: [],
    snapshots: [],
    phaseRun: undefined,
    innerLoopSummary: {
      state: "attempt",
      round: 1,
      attempts: 0,
      stagnationRounds: 0,
      lastDecision: null,
      progressMetric: null,
      budget: null,
    },
    focusRefs: {
      idea: undefined,
      plan: undefined,
      experiments: [],
      claims: [],
      exhibits: [],
      paper: undefined,
      submission: undefined,
    },
    ideaDetails: null,
    planDetails: null,
    experimentSummaries: [],
    claimSummaries: [],
    storySpine: null,
    rqgReports: [],
    latestDiagnosis: null,
    previousCheckpointHistory: [],
    entityCounters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Group 1: generateMarkdownBrief — pure function, no FS needed
// ══════════════════════════════════════════════════════════════════════════════

describe("generateMarkdownBrief", () => {
  test("produces valid markdown with header and sections", () => {
    const ctx = makeMinimalContext()
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("# Human Checkpoint Brief")
    expect(md).toContain("**Project**: test-project")
    expect(md).toContain("**Phase**: explore")
    expect(md).toContain("**Checkpoint**: taste_selection")
    expect(md).toContain("## 🎯 Decision Required")
    expect(md).toContain("Is this the right idea?")
    expect(md).toContain("## 📋 What Happened Since Last Checkpoint")
    expect(md).toContain("## 📊 Current State")
    expect(md).toContain("## 💡 What to Consider")
    expect(md).toContain("## 🔬 Key Entities in Focus")
  })

  test("includes anchor and venue when present", () => {
    const ctx = makeMinimalContext({ anchor: "LLM reasoning", venue: "NeurIPS 2026" })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("**Anchor**: LLM reasoning")
    expect(md).toContain("**Venue**: NeurIPS 2026")
  })

  test("shows first-checkpoint label when no previous checkpoint", () => {
    const ctx = makeMinimalContext()
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("project start — first checkpoint of this kind")
  })

  test("renders timeline events when present", () => {
    const ctx = makeMinimalContext({
      timelineEvents: [
        { ts: "2026-05-15T10:00:00.000Z", type: "idea.created", level: "info", id: "idea_001", summary: "New idea created" },
        { ts: "2026-05-15T11:00:00.000Z", type: "focus.changed", level: "decision", id: undefined as any, summary: "Focus shifted" },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Timeline (2 events)")
    expect(md).toContain("focus.changed")
    expect(md).toContain("idea.created")
  })

  test("renders inner loop with progress metric and budget", () => {
    const ctx = makeMinimalContext({
      innerLoopSummary: {
        state: "evaluate",
        round: 3,
        attempts: 12,
        stagnationRounds: 1,
        lastDecision: "iterate",
        progressMetric: { name: "claim_support_rate", previous: 0.4, current: 0.65 },
        budget: { maxAttempts: 6, maxStagnation: 2 },
      },
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("**State**: evaluate")
    expect(md).toContain("**Round**: 3")
    expect(md).toContain("**Attempts**: 12")
    expect(md).toContain("**Stagnation**: 1 rounds")
    expect(md).toContain("**Last Decision**: iterate")
    expect(md).toContain("**Progress**: claim_support_rate = 0.65 (was: 0.4)")
    expect(md).toContain("**Budget**: max 6 attempts, max 2 stagnation")
  })

  test("renders entity counters and focus refs", () => {
    const ctx = makeMinimalContext({
      entityCounters: { idea: 3, plan: 1, exp: 5, claim: 2, exh: 4, paper: 0, sub: 0 },
      focusRefs: {
        idea: "idea_001",
        plan: undefined,
        experiments: ["exp_001", "exp_002"],
        claims: [],
        exhibits: [],
        paper: undefined,
        submission: undefined,
      },
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("| Ideas | 3 | idea_001 |")
    expect(md).toContain("| Experiments | 5 | exp_001, exp_002 |")
    expect(md).toContain("| Plans | 1 | — |")
  })

  test("renders idea details when present", () => {
    const ctx = makeMinimalContext({
      ideaDetails: {
        id: "idea_001",
        title: "Chain-of-thought self-refinement",
        status: "selected",
        round: 2,
        plan_refs: [],
        derived_from: ["idea_000"],
        selected_by: "human",
        created: "2026-05-10T00:00:00.000Z",
      },
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Selected Idea")
    expect(md).toContain("**idea_001**: Chain-of-thought self-refinement")
    expect(md).toContain("Status: selected")
    expect(md).toContain("Derived from: idea_000")
    expect(md).toContain("Selected by: human")
  })

  test("renders plan details with kill and sufficient criteria", () => {
    const ctx = makeMinimalContext({
      planDetails: {
        id: "plan_001",
        title: "Test plan",
        status: "active",
        created: "2026-05-10T00:00:00.000Z",
        kill_set: [
          { id: "k1", experiment_role: "primary", metric: "accuracy", direction: "min", min_seeds: 3, baseline_value: 0.5, target_delta: 0.1 },
        ],
        sufficient_set: [
          { id: "s1", experiment_role: "primary", metric: "f1", direction: "max", min_seeds: 3, target_value: 0.9 },
        ],
        experiment_refs: [],
        code_artifact_refs: [],
        rqg_refs: [],
        diagnosis_refs: [],
      },
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Active Plan")
    expect(md).toContain("**plan_001**: Test plan")
    expect(md).toContain("Kill criteria: 1")
    expect(md).toContain("Sufficient criteria: 1")
  })

  test("renders experiment summaries", () => {
    const ctx = makeMinimalContext({
      experimentSummaries: [
        { id: "exp_001", title: "Baseline eval", status: "completed", group: "main", metrics: { accuracy: 0.85 }, keyFindings: "Strong baseline" },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Experiments")
    expect(md).toContain("**exp_001**: Baseline eval")
    expect(md).toContain("Status: completed")
    expect(md).toContain("Group: main")
    expect(md).toContain("accuracy=0.85")
    expect(md).toContain("Strong baseline")
  })

  test("renders claim summaries", () => {
    const ctx = makeMinimalContext({
      claimSummaries: [
        { id: "claim_001", title: "CoT improves accuracy", status: "supported", statement: "CoT improves accuracy by 15%", evidenceCount: 3, caveats: ["Only tested on GSM8K"] },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Claims")
    expect(md).toContain("**claim_001**: CoT improves accuracy")
    expect(md).toContain("Statement: CoT improves accuracy by 15%")
    expect(md).toContain("Evidence: 3 items")
    expect(md).toContain("Only tested on GSM8K")
  })

  test("renders previous checkpoint history", () => {
    const ctx = makeMinimalContext({
      previousCheckpointHistory: [
        { decision: "approved", rationale: "Idea looks promising", date: "2026-05-10T08:00:00.000Z" },
        { decision: "confirmed", date: "2026-05-12T10:00:00.000Z" },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("## 📜 Previous Checkpoint Decisions (Same Kind)")
    expect(md).toContain("**approved**")
    expect(md).toContain("Idea looks promising")
    expect(md).toContain("**confirmed**")
  })

  test("renders taste_selection considerations", () => {
    const ctx = makeMinimalContext({ checkpointKind: "taste_selection" })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("**Options:**")
    expect(md).toContain("**Confirm**")
    expect(md).toContain("**Request alternative**")
    expect(md).toContain("**Refine**")
  })

  test("renders reasonableness_check considerations", () => {
    const ctx = makeMinimalContext({ checkpointKind: "reasonableness_check" })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("**Confirm** — Mechanism is reasonable")
    expect(md).toContain("**Request revision**")
    expect(md).toContain("**Pivot**")
  })

  test("renders resource_commitment considerations with spec", () => {
    const ctx = makeMinimalContext({
      checkpointKind: "resource_commitment",
      phaseRun: {
        id: "run_test",
        phase: "design",
        status: "active",
        created: "2026-05-15T00:00:00.000Z",
        updated: "2026-05-15T00:00:00.000Z",
        inner_loop: { state: "attempt", created: "2026-05-15T00:00:00.000Z", updated: "2026-05-15T00:00:00.000Z", round: 1, attempts: 0, stagnation_rounds: 0 },
        human_checkpoints: [
          {
            kind: "resource_commitment",
            status: "pending",
            question: "Approve GPUs?",
            resource_commitment: {
              resource_spec: { gpu_type: "H100", gpu_count: 8, nodes: 2, estimated_gpu_hours: 200 },
              connection_method: "inspire",
              budget_approved: false,
            },
          },
        ],
        artifacts: {},
      } as PhaseRun,
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("H100")
    expect(md).toContain("**Approve with real spec**")
    expect(md).toContain("**Adjust**")
    expect(md).toContain("**Defer**")
  })

  test("renders pivot_confirmation considerations", () => {
    const ctx = makeMinimalContext({ checkpointKind: "pivot_confirmation" })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("**Confirm pivot**")
    expect(md).toContain("**Try one more iteration**")
    expect(md).toContain("**Abort**")
  })

  test("renders paper_ambition considerations", () => {
    const ctx = makeMinimalContext({
      checkpointKind: "paper_ambition",
      claimSummaries: [
        { id: "claim_001", title: "Claim A", status: "supported", evidenceCount: 2, caveats: [] },
        { id: "claim_002", title: "Claim B", status: "weak", evidenceCount: 1, caveats: [] },
      ],
      rqgReports: [
        { id: "rqg_001", overall: "passed", killSetPassed: 3, killSetTotal: 3, sufficientSetPassed: 2, sufficientSetTotal: 3 },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("1 supported/final, 1 weak/candidate")
    expect(md).toContain("RQG: 1/1 reports passed")
    expect(md).toContain("**Scale back**")
  })

  test("renders submission_readiness considerations", () => {
    const ctx = makeMinimalContext({ checkpointKind: "submission_readiness" })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("**Ready to submit**")
    expect(md).toContain("**Need revisions**")
    expect(md).toContain("**Not ready**")
  })

  test("renders default considerations for unknown kind", () => {
    const ctx = makeMinimalContext({ checkpointKind: "custom_checkpoint" as any })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("Review the context above and make a decision")
  })

  test("renders footer with phase run id", () => {
    const ctx = makeMinimalContext({ phaseRunId: "run_abc123" })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("run_abc123")
    expect(md).toContain("AutoResearch v2.1")
  })

  test("renders journal notes when present", () => {
    const ctx = makeMinimalContext({
      journalNotes: [
        { id: "note_001", ts: "2026-05-15T09:00:00.000Z", author: "agent", kind: "design_note" as const, importance: "important" as const, refs: [], summary: "Key insight found", note: "The metric improves with temperature scaling" },
        { id: "note_002", ts: "2026-05-15T10:00:00.000Z", author: "agent", kind: "experiment_note" as const, importance: "normal" as const, refs: [], summary: "Routine update", note: "Experiment running" },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Research Notes (2)")
    expect(md).toContain("Key insight found")
  })

  test("renders human decisions when present", () => {
    const ctx = makeMinimalContext({
      humanDecisions: [
        { id: "dec_001", ts: "2026-05-15T08:00:00.000Z", author: "human", kind: "decision_rationale" as const, importance: "critical" as const, refs: [], summary: "Approved plan", note: "Looks sound" },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Previous Human Decisions (1)")
    expect(md).toContain("Approved plan")
  })

  test("renders snapshots when present", () => {
    const ctx = makeMinimalContext({
      snapshots: [
        { id: "snap_001", trigger: "manual", summary: "Before pivot", created: "2026-05-15T07:00:00.000Z" },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Snapshots (1)")
    expect(md).toContain("Before pivot")
  })

  test("renders story spine when present", () => {
    const ctx = makeMinimalContext({
      storySpine: {
        id: "story_001",
        idea_ref: "idea_001",
        version: 1,
        status: "proposed",
        field_assumption: "LLMs benefit from structured reasoning",
        pain_point: "Current prompting is brittle",
        non_obvious_insight: "Self-refinement creates emergent improvement",
        why_now: "New scaling laws enable longer chains",
        what_changes_if_true: "Prompt engineering becomes systematic",
        beneficiaries: ["ML researchers", "NLP practitioners"],
        candidate_paper_angles: [
          { type: "empirical_finding" as const, title_sketch: "Self-Refine CoT", promise: "15% accuracy gain" },
        ],
        story_risks: ["May not generalize to all domains"],
        scores: {},
        closest_work_positioning: [],
        expected_main_claims: [],
        minimum_evidence: [],
        fallback_paths: [],
        reframe_history: [],
        claim_refs: [],
        grounded_angle: {
          type: "empirical_finding",
          title_sketch: "Self-Refine CoT",
          paper_thesis: "Self-refinement improves CoT reasoning by 15%",
        },
      },
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("## 📖 Story Spine")
    expect(md).toContain("LLMs benefit from structured reasoning")
    expect(md).toContain("Current prompting is brittle")
    expect(md).toContain("Self-refinement creates emergent improvement")
    expect(md).toContain("Candidate Angles")
    expect(md).toContain("Risks")
    expect(md).toContain("Grounded Angle")
  })

  test("renders RQG reports when present", () => {
    const ctx = makeMinimalContext({
      rqgReports: [
        { id: "rqg_001", overall: "passed", killSetPassed: 2, killSetTotal: 2, sufficientSetPassed: 1, sufficientSetTotal: 3 },
      ],
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Result Quality Gate")
    expect(md).toContain("rqg_001")
    expect(md).toContain("Overall: **passed**")
  })

  test("renders pending checkpoints from phase run", () => {
    const ctx = makeMinimalContext({
      phaseRun: {
        id: "run_test",
        phase: "design",
        status: "active",
        created: "2026-05-15T00:00:00.000Z",
        updated: "2026-05-15T00:00:00.000Z",
        inner_loop: { state: "attempt", created: "2026-05-15T00:00:00.000Z", updated: "2026-05-15T00:00:00.000Z", round: 1, attempts: 0, stagnation_rounds: 0 },
        human_checkpoints: [
          { kind: "taste_selection", status: "pending", question: "Approve idea?" },
          { kind: "reasonableness_check", status: "pending", question: "Is the plan reasonable?" },
        ],
        artifacts: {},
      } as PhaseRun,
    })
    const md = generateMarkdownBrief(ctx)

    expect(md).toContain("### Pending Checkpoints")
    expect(md).toContain("[taste_selection]")
    expect(md).toContain("[reasonableness_check]")
  })

  test("renders empty-project brief without errors", () => {
    const ctx = makeMinimalContext()
    const md = generateMarkdownBrief(ctx)

    // No entities, no events — sections still render with "no data" messages
    expect(md).toContain("*No timeline events in this window.*")
    expect(md).toContain("| Ideas | 0 | — |")
    expect(md).not.toContain("### Research Notes")
    expect(md).not.toContain("### Experiments")
    expect(md).not.toContain("### Claims")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 2: gatherCheckpointContext — integration with FS
// ══════════════════════════════════════════════════════════════════════════════

describe("gatherCheckpointContext", () => {
  const TMP = makeTmp("gather")
  beforeAll(async () => {
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
    await seedProject(TMP, { state: { project: "gather-test" } })
  })
  afterAll(async () => { await cleanup(TMP) })

  test("returns null when state.yaml is missing", async () => {
    const emptyTmp = makeTmp("gather-empty")
    try {
      await fs.mkdir(path.join(emptyTmp, ".research"), { recursive: true })
      // Use explicit directory override, not initContext (which would clobber the default)
      const result = await runWithDirectory(emptyTmp, () =>
        gatherCheckpointContext({
          phaseRunId: "run_missing",
          checkpointKind: "taste_selection",
          checkpointQuestion: "Test?",
        }),
      )
      expect(result).toBeNull()
    } finally {
      await cleanup(emptyTmp)
    }
  })

  test("returns context for empty project (no entities, no prior checkpoints)", async () => {
    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: "run_nonexistent",
        checkpointKind: "taste_selection",
        checkpointQuestion: "Is this idea right?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.project).toBe("gather-test")
    expect(result!.checkpointKind).toBe("taste_selection")
    expect(result!.checkpointQuestion).toBe("Is this idea right?")
    expect(result!.sinceTimestamp).toBeNull()
    expect(result!.sinceLabel).toContain("project start")
    expect(result!.timelineEvents).toEqual([])
    expect(result!.journalNotes).toEqual([])
    expect(result!.humanDecisions).toEqual([])
    expect(result!.snapshots).toEqual([])
    expect(result!.phaseRun).toBeUndefined()
    expect(result!.ideaDetails).toBeNull()
    expect(result!.planDetails).toBeNull()
    expect(result!.experimentSummaries).toEqual([])
    expect(result!.claimSummaries).toEqual([])
    expect(result!.storySpine).toBeNull()
    expect(result!.rqgReports).toEqual([])
    expect(result!.latestDiagnosis).toBeNull()
    expect(result!.previousCheckpointHistory).toEqual([])
    expect(result!.entityCounters).toBeDefined()
  })

  test("finds existing phase run", async () => {
    const runId = await runWithDirectory(undefined, () => createTestRun("explore"))

    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: runId,
        checkpointKind: "taste_selection",
        checkpointQuestion: "Approve?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.phaseRun).toBeDefined()
    expect(result!.phaseRun!.id).toBe(runId)
    expect(result!.phaseRun!.phase).toBe("explore")
    expect(result!.innerLoopSummary).toBeDefined()
    expect(result!.innerLoopSummary.state).toBe("attempt")
  })

  test("resolves focus refs from state", async () => {
    // Write state with focus refs
    const stateYaml = await Bun.file(path.join(TMP, ".research", "state.yaml")).text()
    const state = YAML.parse(stateYaml)
    state.focus = {
      since: new Date().toISOString(),
      phase: "design",
      active_phase_run: "run_focus_test",
      refs: {
        idea_ref: "idea_001",
        experiment_refs: ["exp_001"],
      },
    }
    await Bun.write(path.join(TMP, ".research", "state.yaml"), YAML.stringify(state))

    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: "run_focus_test",
        checkpointKind: "reasonableness_check",
        checkpointQuestion: "Plan ok?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.focusRefs.idea).toBe("idea_001")
    expect(result!.focusRefs.experiments).toContain("exp_001")
    expect(result!.currentPhase).toBe("design")
  })

  test("finds sinceTimestamp when prior confirmed checkpoint exists", async () => {
    // Create a phase run and add + confirm a checkpoint
    const runId = await runWithDirectory(undefined, () => createTestRun("explore"))
    await runWithDirectory(undefined, () =>
      PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "First idea check?",
      }),
    )
    await runWithDirectory(undefined, () =>
      PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved", "Good idea"),
    )

    // Now gather context for the same checkpoint kind
    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: runId,
        checkpointKind: "taste_selection",
        checkpointQuestion: "Second check?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.sinceTimestamp).not.toBeNull()
    expect(result!.previousCheckpointHistory.length).toBeGreaterThan(0)
    expect(result!.previousCheckpointHistory[0].decision).toBe("approved")
  })

  test("previousCheckpointHistory excludes pending checkpoints", async () => {
    const runId = await runWithDirectory(undefined, () => createTestRun("design"))
    // Add a pending checkpoint (do not confirm/waive)
    await runWithDirectory(undefined, () =>
      PhaseRunManager.addCheckpoint(runId, {
        kind: "reasonableness_check",
        question: "Pending only?",
      }),
    )

    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: runId,
        checkpointKind: "reasonableness_check",
        checkpointQuestion: "Another check?",
      }),
    )

    expect(result).not.toBeNull()
    // History only includes non-pending checkpoints with decisions
    for (const entry of result!.previousCheckpointHistory) {
      expect(entry.decision).toBeTruthy()
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 3: generateAndSaveBrief — writes .md file
// ══════════════════════════════════════════════════════════════════════════════

describe("generateAndSaveBrief", () => {
  const TMP = makeTmp("save")
  beforeAll(async () => {
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
    await seedProject(TMP, { state: { project: "save-brief-test" } })
  })
  afterAll(async () => { await cleanup(TMP) })

  test("returns null when state.yaml is missing", async () => {
    const emptyTmp = makeTmp("save-empty")
    try {
      await fs.mkdir(path.join(emptyTmp, ".research"), { recursive: true })
      // Use explicit directory override, not initContext (which would clobber the default)
      const result = await runWithDirectory(emptyTmp, () =>
        generateAndSaveBrief({
          phaseRunId: "run_missing",
          checkpointKind: "taste_selection",
          checkpointQuestion: "Test?",
        }),
      )
      expect(result).toBeNull()
    } finally {
      await cleanup(emptyTmp)
    }
  })

  test("writes a .md file and returns brief metadata", async () => {
    const runId = await runWithDirectory(undefined, () => createTestRun("explore"))

    const result = await runWithDirectory(undefined, () =>
      generateAndSaveBrief({
        phaseRunId: runId,
        checkpointKind: "taste_selection",
        checkpointQuestion: "Should we proceed with this idea?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.id).toMatch(/^brief_\d+_\w+$/)
    expect(result!.generatedAt).toBeTruthy()
    expect(result!.filePath).toContain("checkpoint_briefs/")
    expect(result!.filePath).toContain(".md")

    // Verify the file exists on disk
    const fullPath = path.join(TMP, ".research", result!.filePath)
    const exists = await fs.access(fullPath).then(() => true, () => false)
    expect(exists).toBe(true)

    // Verify the content is valid markdown
    const content = await Bun.file(fullPath).text()
    expect(content).toContain("# Human Checkpoint Brief")
    expect(content).toContain("Should we proceed with this idea?")
  })

  test("brief file can be read back with readBrief", async () => {
    const runId = await runWithDirectory(undefined, () => createTestRun("ground"))

    const brief = await runWithDirectory(undefined, () =>
      generateAndSaveBrief({
        phaseRunId: runId,
        checkpointKind: "reasonableness_check",
        checkpointQuestion: "Is the plan reasonable?",
      }),
    )

    expect(brief).not.toBeNull()
    const content = await runWithDirectory(undefined, () => readBrief(brief!.filePath))
    expect(content).toBeTruthy()
    expect(content).toContain("# Human Checkpoint Brief")
    expect(content).toContain("reasonableness_check")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group 4: findLastCheckpointTime (tested via gatherCheckpointContext)
// ══════════════════════════════════════════════════════════════════════════════

describe("findLastCheckpointTime (via gatherCheckpointContext)", () => {
  const TMP = makeTmp("lastcp")
  beforeAll(async () => {
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
    await seedProject(TMP, { state: { project: "lastcp-test" } })
  })
  afterAll(async () => { await cleanup(TMP) })

  test("returns null when no prior checkpoints exist", async () => {
    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: "run_none",
        checkpointKind: "taste_selection",
        checkpointQuestion: "First ever?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.sinceTimestamp).toBeNull()
  })

  test("returns null when only pending checkpoints exist", async () => {
    const runId = await runWithDirectory(undefined, () => createTestRun("explore"))
    await runWithDirectory(undefined, () =>
      PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "Still pending?",
      }),
    )

    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: runId,
        checkpointKind: "taste_selection",
        checkpointQuestion: "Another check?",
      }),
    )

    expect(result).not.toBeNull()
    // findLastCheckpointTime only looks at non-pending checkpoints
    expect(result!.sinceTimestamp).toBeNull()
  })

  test("returns timestamp of most recent confirmed checkpoint", async () => {
    const runId = await runWithDirectory(undefined, () => createTestRun("design"))

    // Add and confirm first taste_selection
    await runWithDirectory(undefined, () =>
      PhaseRunManager.addCheckpoint(runId, {
        kind: "taste_selection",
        question: "First check?",
      }),
    )
    await runWithDirectory(undefined, () =>
      PhaseRunManager.confirmCheckpoint(runId, "taste_selection", "approved", "OK"),
    )

    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: runId,
        checkpointKind: "taste_selection",
        checkpointQuestion: "Second check?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.sinceTimestamp).not.toBeNull()
    // Should be a valid ISO string
    expect(new Date(result!.sinceTimestamp!).toISOString()).toBe(result!.sinceTimestamp)
  })

  test("returns timestamp of most recent waived checkpoint", async () => {
    const runId = await runWithDirectory(undefined, () => createTestRun("experiment"))

    await runWithDirectory(undefined, () =>
      PhaseRunManager.addCheckpoint(runId, {
        kind: "paper_ambition",
        question: "Ready to write?",
      }),
    )
    await runWithDirectory(undefined, () =>
      PhaseRunManager.waiveCheckpoint(runId, "paper_ambition", "Not yet"),
    )

    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: runId,
        checkpointKind: "paper_ambition",
        checkpointQuestion: "Ready now?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.sinceTimestamp).not.toBeNull()
  })

  test("finds checkpoint across different phase runs", async () => {
    // Create first run with a confirmed checkpoint
    const runId1 = await runWithDirectory(undefined, () => createTestRun("explore"))
    await runWithDirectory(undefined, () =>
      PhaseRunManager.addCheckpoint(runId1, {
        kind: "taste_selection",
        question: "First run check?",
      }),
    )
    await runWithDirectory(undefined, () =>
      PhaseRunManager.confirmCheckpoint(runId1, "taste_selection", "approved"),
    )

    // Create second run and gather context for same kind
    const runId2 = await runWithDirectory(undefined, () => createTestRun("ground"))
    const result = await runWithDirectory(undefined, () =>
      gatherCheckpointContext({
        phaseRunId: runId2,
        checkpointKind: "taste_selection",
        checkpointQuestion: "Second run check?",
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.sinceTimestamp).not.toBeNull()
    // The previousCheckpointHistory should include the first run's checkpoint
    expect(result!.previousCheckpointHistory.length).toBeGreaterThanOrEqual(1)
  })

  test("ignores checkpoints of different kind", async () => {
    // Use an isolated TMP to avoid interference from other tests' checkpoints.
    // We do NOT call initContext here — runWithDirectory(isolatedTmp) overrides
    // the runtime directory without clobbering the default context.
    const isolatedTmp = makeTmp("lastcp-isolated")
    try {
      // Need initContext + seedProject for the isolated dir
      initContext({ directory: isolatedTmp, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
      await seedProject(isolatedTmp, { state: { project: "lastcp-isolated" } })

      const runId = await runWithDirectory(undefined, () => createTestRun("design"))

      // Add and confirm a reasonableness_check
      await runWithDirectory(undefined, () =>
        PhaseRunManager.addCheckpoint(runId, {
          kind: "reasonableness_check",
          question: "Plan ok?",
        }),
      )
      await runWithDirectory(undefined, () =>
        PhaseRunManager.confirmCheckpoint(runId, "reasonableness_check", "confirmed"),
      )

      // Now check for taste_selection — should not find the reasonableness_check
      const result = await runWithDirectory(undefined, () =>
        gatherCheckpointContext({
          phaseRunId: runId,
          checkpointKind: "taste_selection",
          checkpointQuestion: "Idea ok?",
        }),
      )

      expect(result).not.toBeNull()
      expect(result!.sinceTimestamp).toBeNull()
    } finally {
      // Restore original context before cleanup
      initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
      await cleanup(isolatedTmp)
    }
  })
})
