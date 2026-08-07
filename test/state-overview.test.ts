import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { ResearchTimeline } from "../src/timeline"
import { researchState } from "../src/tools/state"
import { stubAccessor, stubAuth, stubCache, stubCtx } from "./helpers"
import type { ToolResult } from "@ericsanchezok/synergy-plugin"
import {
  ExplorationConfig, GroundConfig, DesignConfig, RealizeConfig, ExperimentConfig,
  ComposeConfig,
} from "../src/schema"
import type {
  IdeaYaml, PlanYaml, ExperimentYaml, ClaimYaml,
  ExhibitYaml, PaperYaml, SubmissionYaml, StateYaml,
} from "../src/schema"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Helpers ───────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-overview-test-${Date.now()}`)

async function callOverview() {
  return researchState.execute({ action: "overview" as any }, stubCtx) as Promise<ToolResult>
}

async function seedProject(tmpDir: string, opts?: { empty?: boolean }) {
  const rd = path.join(tmpDir, ".research")
  for (const dir of ["ideas", "plans", "experiments", "claims", "exhibits", "manuscripts", "submissions", "literature"]) {
    await fs.mkdir(path.join(rd, dir), { recursive: true })
  }

  if (opts?.empty) {
    const state: StateYaml = {
      project: "empty-project",
      schema_version: 2,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
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
    }
    await Bun.write(path.join(rd, "state.yaml"), YAML.stringify(state))
    return
  }

  const state: StateYaml = {
    project: "overview-test",
    schema_version: 2,
    created: "2026-01-01T00:00:00Z",
    updated: "2026-04-01T00:00:00Z",
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
    counters: { idea: 3, plan: 2, exp: 6, claim: 4, exh: 2, paper: 1, sub: 1 },
    focus: {
      since: "2026-03-15T00:00:00Z",
      phase: "experiment",
      summary: "Running ablation experiments",
      refs: {
        idea_ref: "idea_003",
        plan_ref: "plan_002",
        experiment_refs: ["exp_003", "exp_004", "exp_005"],
        claim_refs: ["claim_003", "claim_004"],
        paper_ref: "paper_001",
        submission_ref: "sub_001",
      },
      blocked_on: null,
      next: "Complete ablation analysis",
    },
  }
  await Bun.write(path.join(rd, "state.yaml"), YAML.stringify(state))

  // Ideas
  const ideas: IdeaYaml[] = [
    { id: "idea_001", title: "Direction A", status: "rejected", round: 1, created: "2026-01-10T00:00:00Z", plan_refs: [] },
    { id: "idea_002", title: "Direction B", status: "parked", round: 1, created: "2026-01-12T00:00:00Z", plan_refs: [] },
    { id: "idea_003", title: "Reasoning drift", status: "selected", round: 1, selected_by: "user", selected_date: "2026-02-10T00:00:00Z", created: "2026-01-15T00:00:00Z", plan_refs: [] },
  ]
  for (const y of ideas) await ResearchFS.writeYaml(ResearchFS.resolve("ideas", `${y.id}.yaml`), y)

  // Plans
  const plans: PlanYaml[] = [
    { id: "plan_001", title: "Initial plan", status: "superseded", idea_ref: "idea_003", created: "2026-02-15T00:00:00Z", kill_set: [], sufficient_set: [], experiment_refs: [], code_artifact_refs: [], rqg_refs: [], diagnosis_refs: [] },
    { id: "plan_002", title: "Revised plan", status: "active", idea_ref: "idea_003", supersedes: "plan_001", created: "2026-03-01T00:00:00Z", kill_set: [], sufficient_set: [], experiment_refs: [], code_artifact_refs: [], rqg_refs: [], diagnosis_refs: [] },
  ]
  for (const y of plans) await ResearchFS.writeYaml(ResearchFS.resolve("plans", `${y.id}.yaml`), y)

  // Experiments — exp_006 is orphan (no plan/idea)
  const exps: ExperimentYaml[] = [
    { id: "exp_001", title: "Baseline v1", status: "completed", group: "baselines", plan_ref: "plan_001", created: "2026-02-20T00:00:00Z", rqg_contributions: [], log: [], notes: [] },
    { id: "exp_002", title: "Baseline v2", status: "completed", group: "baselines", plan_ref: "plan_001", created: "2026-02-22T00:00:00Z", rqg_contributions: [], log: [], notes: [] },
    { id: "exp_003", title: "Main method", status: "completed", group: "main", plan_ref: "plan_002", created: "2026-03-05T00:00:00Z", rqg_contributions: [], log: [], notes: [] },
    { id: "exp_004", title: "Ablation A", status: "completed", group: "ablations", plan_ref: "plan_002", created: "2026-03-10T00:00:00Z", rqg_contributions: [], log: [], notes: [] },
    { id: "exp_005", title: "Ablation B", status: "failed", group: "ablations", plan_ref: "plan_002", failure_reason: "OOM", created: "2026-03-12T00:00:00Z", rqg_contributions: [], log: [], notes: [] },
    { id: "exp_006", title: "Orphan exp", status: "completed", group: "sanity", created: "2026-03-14T00:00:00Z", rqg_contributions: [], log: [], notes: [] },
  ]
  for (const y of exps) await ResearchFS.writeYaml(ResearchFS.resolve("experiments", `${y.id}.yaml`), y)

  // Claims — claim_003 (weak) and claim_004 (candidate) need more evidence
  // Evidence refs: exp_001, exp_002, exp_003, exp_004 are referenced; exp_006 is NOT
  const claims: ClaimYaml[] = [
    { id: "claim_001", title: "Baseline claim", status: "supported", evidence: [{ ref: "exp_001" }, { ref: "exp_002" }], caveats: [], paper_section: "5.1", created: "2026-03-01T00:00:00Z" },
    { id: "claim_002", title: "Method claim", status: "supported", evidence: [{ ref: "exp_003", strength: "strong" }], caveats: [], paper_section: "5.2", created: "2026-03-15T00:00:00Z" },
    { id: "claim_003", title: "Ablation claim A", status: "weak", evidence: [{ ref: "exp_004", strength: "weak" }], caveats: ["small sample"], paper_section: "5.3", created: "2026-03-20T00:00:00Z" },
    { id: "claim_004", title: "Ablation claim B", status: "candidate", evidence: [], caveats: [], paper_section: "5.4", created: "2026-03-22T00:00:00Z" },
  ]
  for (const y of claims) await ResearchFS.writeYaml(ResearchFS.resolve("claims", `${y.id}.yaml`), y)

  // Exhibits
  const exhibits: ExhibitYaml[] = [
    { id: "exh_001", title: "Main results table", kind: "table", status: "approved", sources: { experiments: ["exp_003"], claims: ["claim_002"] }, created: "2026-03-18T00:00:00Z" },
    { id: "exh_002", title: "Ablation figure", kind: "figure", status: "draft", sources: { experiments: ["exp_004"], claims: ["claim_003"] }, created: "2026-03-22T00:00:00Z" },
  ]
  for (const y of exhibits) await ResearchFS.writeYaml(ResearchFS.resolve("exhibits", `${y.id}.yaml`), y)

  // Paper — claims bound: [claim_001, claim_002]; sections with paper_section in those claims: 5.1, 5.2
  // Unbound sections = sections whose name doesn't match any bound claim's paper_section
  const paper: PaperYaml = {
    id: "paper_001",
    title: "Reasoning Drift in Self-Correction",
    status: "drafting",
    sections: [
      { name: "Introduction", status: "drafted" },
      { name: "Related Work", status: "drafted" },
      { name: "Method", status: "pending" },
      { name: "Experiments", status: "pending" },
      { name: "Results", file: "results.tex", status: "drafted" },
      { name: "Conclusion", status: "pending" },
    ],
    claims: ["claim_001", "claim_002"],
    exhibits: ["exh_001"],
    created: "2026-03-25T00:00:00Z",
  }
  await ResearchFS.writeYaml(ResearchFS.resolve("manuscripts", "paper_001.yaml"), paper)

  // Submission
  const sub: SubmissionYaml = {
    id: "sub_001",
    title: "Reasoning Drift in Self-Correction",
    status: "preparing",
    paper: "paper_001",
    venue: "NeurIPS 2026",
    rounds: [],
    created: "2026-04-01T00:00:00Z",
  }
  await ResearchFS.writeYaml(ResearchFS.resolve("submissions", "sub_001.yaml"), sub)

  // Timeline events
  await ResearchTimeline.append({ type: "idea.created", id: "idea_001", summary: "Created Direction A" })
  await ResearchTimeline.append({ type: "idea.created", id: "idea_003", summary: "Created Reasoning drift" })
  await ResearchTimeline.append({ type: "idea.status", id: "idea_003", from: "proposed", to: "selected", summary: "Selected as main direction" })
  await ResearchTimeline.append({ type: "focus.changed", phase: "explore", to: "explore", summary: "Entered explore phase" })
  await ResearchTimeline.append({ type: "focus.changed", phase: "experiment", from: "ground", to: "experiment", summary: "Advanced to experiment" })
  await ResearchTimeline.append({ type: "exp.created", id: "exp_003", summary: "Created Main method" })
  await ResearchTimeline.append({ type: "exp.status", id: "exp_003", from: "scheduled", to: "completed", summary: "Main method completed" })
  await ResearchTimeline.append({ type: "exp.status", id: "exp_005", from: "running", to: "failed", summary: "Ablation B OOM" })
  await ResearchTimeline.append({ type: "claim.created", id: "claim_003", summary: "Created Ablation claim A" })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("research_state overview", () => {
  beforeAll(async () => {
    initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
    await seedProject(TMP)
  })
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

  test("returns project identity and phase info", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      expect(result.title).toBe("Research Overview")
      expect(result.output).toContain("overview-test")
      expect(result.output).toContain("experiment")
      expect(result.metadata!.phase).toBe("experiment")
    })
  })

  test("shows pipeline entities with status counts", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      const output = result.output
      const m = result.metadata!

      // Key pipeline refs
      expect(output).toContain("idea_003")
      expect(output).toContain("plan_002")
      expect(output).toContain("paper_001")
      expect(output).toContain("sub_001")

      // Experiment counts — 5 completed (exp_001–004 + orphan exp_006), 1 failed (exp_005)
      expect(m.pipeline.experiments.total).toBe(6)
      expect(m.pipeline.experiments.by_status.completed).toBe(5)
      expect(m.pipeline.experiments.by_status.failed).toBe(1)

      // Claim counts
      expect(m.pipeline.claims.total).toBe(4)
      expect(m.pipeline.claims.by_status.supported).toBe(2)
      expect(m.pipeline.claims.by_status.weak).toBe(1)
      expect(m.pipeline.claims.by_status.candidate).toBe(1)

      // Exhibit counts
      expect(m.pipeline.exhibits.total).toBe(2)
    })
  })

  test("detects orphan experiments", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      const orphans = result.metadata!.gaps.orphan_experiments
      expect(orphans.some((e) => e.id === "exp_006")).toBe(true)
      expect(orphans.find((e) => e.id === "exp_006")!.md_path).toBe(".research/experiments/exp_006.md")
    })
  })

  test("detects unanalyzed experiments (completed, no claim evidence ref)", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      const unanalyzed = result.metadata!.gaps.unanalyzed_experiments
      // exp_006 is completed and not in any claim's evidence
      expect(unanalyzed.some((e) => e.id === "exp_006")).toBe(true)
      // exp_001–004 are in claim evidence, should NOT be flagged
      expect(unanalyzed.some((e) => e.id === "exp_003")).toBe(false)
    })
  })

  test("detects weak claims", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      const weak = result.metadata!.gaps.weak_claims
      expect(weak.some((c) => c.id === "claim_003")).toBe(true)
      expect(weak.some((c) => c.id === "claim_004")).toBe(true)
      expect(weak.some((c) => c.id === "claim_001")).toBe(false)
      // Paths are present
      expect(weak.find((c) => c.id === "claim_003")!.md_path).toBe(".research/claims/claim_003.md")
    })
  })

  test("detects unbound paper sections", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      // paper.claims = [claim_001, claim_002] → sections 5.1, 5.2 are bound
      // Other sections are unbound
      const unbound: string[] = result.metadata!.gaps.unbound_paper_sections
      expect(unbound.length).toBeGreaterThan(0)
    })
  })

  test("includes recent timeline summary in output", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      expect(result.output).toContain("Recent Activity")
    })
  })

  test("returns structured metadata for programmatic access", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await callOverview()
      const m = result.metadata!
      expect(m.project).toBe("overview-test")
      expect(m.anchor).toBeNull()
      expect(m.phase).toBe("experiment")
      expect(m.pipeline.idea.id).toBe("idea_003")
      expect(m.pipeline.plan.id).toBe("plan_002")
      expect(m.pipeline.paper.id).toBe("paper_001")
      expect(m.pipeline.submission.id).toBe("sub_001")
      expect(m.gaps).toBeDefined()
    })
  })
})
