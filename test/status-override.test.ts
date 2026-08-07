import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { ResearchJournal } from "../src/journal"
import { researchExperiment } from "../src/tools/experiment"
import { researchClaim } from "../src/tools/claim"
import { researchIdea } from "../src/tools/idea"
import { researchPlan } from "../src/tools/plan"
import { researchExhibit } from "../src/tools/exhibit"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import type { ToolContext, ToolResult } from "@ericsanchezok/synergy-plugin/tool"
import type { JournalNote } from "../src/schema"
import path from "path"
import fs from "fs/promises"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-status-override-test-${Date.now()}`)

const stubCtx: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test",
  abort: new AbortController().signal,
}

beforeAll(async () => {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await seedProject(TMP, {
    state: {
      project: "test-status-override",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
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
      counters: { idea: 1, plan: 1, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
      focus: { since: "2026-01-01T00:00:00Z", phase: "experiment", blocked_on: null },
    },
    extraFiles: ["journal/research_notes.jsonl"],
  })
})

afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }) })

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callExperiment(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchExperiment.execute({ action: action as any, ...params }, stubCtx) as Promise<ToolResult>
}

async function callClaim(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchClaim.execute({ action: action as any, ...params }, stubCtx) as Promise<ToolResult>
}

async function callIdea(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchIdea.execute({ action: action as any, ...params }, stubCtx) as Promise<ToolResult>
}

async function callPlan(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchPlan.execute({ action: action as any, ...params }, stubCtx) as Promise<ToolResult>
}

async function callExhibit(action: string, params: Record<string, any> = {}): Promise<ToolResult> {
  return researchExhibit.execute({ action: action as any, ...params }, stubCtx) as Promise<ToolResult>
}

async function readJournalNotes(): Promise<JournalNote[]> {
  const filePath = ResearchFS.resolve("journal/research_notes.jsonl")
  return ResearchFS.readJsonl<JournalNote>(filePath)
}

async function findStatusOverrideNotes(refId: string): Promise<JournalNote[]> {
  const notes = await readJournalNotes()
  return notes.filter(n => n.kind === "status_override" && n.refs.includes(refId))
}

// ══════════════════════════════════════════════════════════════════════════════
// Claim update to "final" — gate enforcement
// ══════════════════════════════════════════════════════════════════════════════

describe("claim update to final — gate enforcement", () => {
  test("blocked by red-line violations in evidence", async () => {
    await runWithDirectory(TMP, async () => {
      // Register experiment with red-lines, pass them first
      const expR = await callExperiment("register", {
        title: "Redline violation evidence",
        redlines: ["R1_metric_immutability"],
        authenticity: "evidence",
      })
      const expId = (expR.metadata as any).id as string

      // Pass red-lines first so experiment can be completed
      await callExperiment("update", { id: expId, redline_status: { R1_metric_immutability: "passed" } })
      // Force to completed via update
      await callExperiment("update", { id: expId, force: true, status: "completed" })

      // Now re-violate the red-line directly in YAML (simulating post-completion audit)
      const expPath = path.join(TMP, ".research", "experiments", `${expId}.yaml`)
      const YAML = await import("yaml")
      const expYaml = YAML.parse(await fs.readFile(expPath, "utf-8")) as any
      expYaml.redlines.status.R1_metric_immutability = "violated"
      await fs.writeFile(expPath, YAML.stringify(expYaml))

      // Create claim with this evidence
      const claimR = await callClaim("create", {
        title: "Redline blocked claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      })
      const claimId = (claimR.metadata as any).id as string

      // Attempt update to "final" — should be blocked by red-line gate
      const result = await callClaim("update", { id: claimId, force: true, status: "final" })

      expect(result.output).toContain("❌")
      expect(result.output).toContain("red-line")
      expect(result.metadata).toHaveProperty("error", "redline_blocked")
    })
  })

  test("blocked by prototype authenticity in evidence", async () => {
    await runWithDirectory(TMP, async () => {
      // Register a prototype-grade experiment (no red-lines)
      const expR = await callExperiment("register", {
        title: "Prototype evidence",
        authenticity: "prototype",
      })
      const expId = (expR.metadata as any).id as string

      // Force to completed by directly modifying YAML
      // (update gate now blocks prototype → completed, so we bypass it)
      const expPath = path.join(TMP, ".research", "experiments", `${expId}.yaml`)
      const YAML = await import("yaml")
      const expYaml = YAML.parse(await fs.readFile(expPath, "utf-8")) as any
      expYaml.status = "completed"
      await fs.writeFile(expPath, YAML.stringify(expYaml))

      // Create claim with this experiment as evidence
      const claimR = await callClaim("create", {
        title: "Authenticity blocked claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      })
      const claimId = (claimR.metadata as any).id as string

      // Attempt update to "final" — should be blocked by authenticity gate
      const result = await callClaim("update", { id: claimId, force: true, status: "final" })

      expect(result.output).toContain("❌")
      expect(result.metadata).toHaveProperty("error", "authenticity_blocked")
    })
  })

  test("succeeds with valid evidence-grade experiment", async () => {
    await runWithDirectory(TMP, async () => {
      // Register evidence-grade experiment with red-lines, pass all
      const expR = await callExperiment("register", {
        title: "Valid evidence",
        redlines: ["R1_metric_immutability", "R6_reproducibility"],
        authenticity: "evidence",
      })
      const expId = (expR.metadata as any).id as string

      // Pass all red-lines
      await callExperiment("update", {
        id: expId,
        redline_status: { R1_metric_immutability: "passed", R6_reproducibility: "passed" },
      })

      // Complete through normal lifecycle
      await callExperiment("schedule", { id: expId })
      await callExperiment("start", { id: expId })
      await callExperiment("complete", { id: expId, metrics: { accuracy: 0.92 } })

      // Create claim with this evidence
      const claimR = await callClaim("create", {
        title: "Valid claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      })
      const claimId = (claimR.metadata as any).id as string

      // Support first (normal flow), then update to final
      await callClaim("support", { id: claimId })
      const result = await callClaim("update", { id: claimId, force: true, status: "final" })

      expect(result.output).toContain("✅")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Experiment update to "completed" — gate enforcement
// ══════════════════════════════════════════════════════════════════════════════

describe("experiment update to completed — gate enforcement", () => {
  test("blocked by red-line violations", async () => {
    await runWithDirectory(TMP, async () => {
      // Register with red-lines
      const regResult = await callExperiment("register", {
        title: "Redline gate test",
        redlines: ["R1_metric_immutability", "R6_reproducibility"],
        authenticity: "evidence",
      })
      const expId = (regResult.metadata as any).id as string

      // Leave red-lines as pending (not passed)

      // Attempt update to "completed" — should be blocked
      const result = await callExperiment("update", { id: expId, force: true, status: "completed" })

      expect(result.output).toContain("❌")
      expect(result.metadata).toHaveProperty("error", "redline_blocked")
    })
  })

  test("succeeds when all red-lines passed", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await callExperiment("register", {
        title: "Pass gate test",
        redlines: ["R1_metric_immutability"],
        authenticity: "evidence",
      })
      const expId = (regResult.metadata as any).id as string

      // Pass all red-lines
      await callExperiment("update", {
        id: expId,
        redline_status: { R1_metric_immutability: "passed" },
      })

      // Update to completed should work
      const result = await callExperiment("update", { id: expId, force: true, status: "completed" })

      expect(result.output).toContain("✅")
    })
  })

  test("succeeds when no red-lines declared", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await callExperiment("register", {
        title: "No redlines test",
        authenticity: "evidence",
      })
      const expId = (regResult.metadata as any).id as string

      const result = await callExperiment("update", { id: expId, force: true, status: "completed" })

      expect(result.output).toContain("✅")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Status override creates journal entry
// ══════════════════════════════════════════════════════════════════════════════

describe("status override creates journal entry", () => {
  test("experiment update with status change creates status_override journal note", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await callExperiment("register", {
        title: "Journal test experiment",
        authenticity: "evidence",
      })
      const expId = (regResult.metadata as any).id as string

      // Update status
      await callExperiment("update", { id: expId, force: true, status: "completed" })

      // Check journal
      const notes = await findStatusOverrideNotes(expId)
      expect(notes.length).toBeGreaterThanOrEqual(1)

      const note = notes[notes.length - 1]!
      expect(note.kind).toBe("status_override")
      expect(note.importance).toBe("critical")
      expect(note.refs).toContain(expId)
      expect(note.summary).toContain("status overridden")
      expect(note.note).toContain("bypassed")
    })
  })

  test("claim update with status change creates status_override journal note", async () => {
    await runWithDirectory(TMP, async () => {
      // Create evidence-grade experiment, complete it
      const expR = await callExperiment("register", {
        title: "Claim journal evidence",
        authenticity: "evidence",
      })
      const expId = (expR.metadata as any).id as string
      await callExperiment("update", { id: expId, force: true, status: "completed" })

      const claimR = await callClaim("create", {
        title: "Journal test claim",
        evidence: [{ ref: expId, role: "primary", strength: "strong" }],
      })
      const claimId = (claimR.metadata as any).id as string

      // Update status (bypass to supported first, then to final)
      await callClaim("update", { id: claimId, force: true, status: "supported" })

      const notes = await findStatusOverrideNotes(claimId)
      expect(notes.length).toBeGreaterThanOrEqual(1)

      const note = notes[notes.length - 1]!
      expect(note.kind).toBe("status_override")
      expect(note.importance).toBe("critical")
      expect(note.refs).toContain(claimId)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// All entity types write journal on status override
// ══════════════════════════════════════════════════════════════════════════════

describe("all entity types write status_override journal on update", () => {
  test("idea update with status change creates journal entry", async () => {
    await runWithDirectory(TMP, async () => {
      const createResult = await callIdea("create", { title: "Journal test idea" })
      const id = (createResult.metadata as any).id as string

      // Update status via update action
      await callIdea("update", { id, force: true, status: "exploring" })

      const notes = await findStatusOverrideNotes(id)
      expect(notes.length).toBeGreaterThanOrEqual(1)

      const note = notes[notes.length - 1]!
      expect(note.kind).toBe("status_override")
      expect(note.importance).toBe("critical")
      expect(note.refs).toContain(id)
      expect(note.phase).toBe("explore")
    })
  })

  test("plan update with status change creates journal entry", async () => {
    await runWithDirectory(TMP, async () => {
      const createResult = await callPlan("create", { title: "Journal test plan" })
      const id = (createResult.metadata as any).id as string

      // Update status via update action
      await callPlan("update", { id, force: true, status: "cancelled" })

      const notes = await findStatusOverrideNotes(id)
      expect(notes.length).toBeGreaterThanOrEqual(1)

      const note = notes[notes.length - 1]!
      expect(note.kind).toBe("status_override")
      expect(note.importance).toBe("critical")
      expect(note.refs).toContain(id)
      expect(note.phase).toBe("design")
    })
  })

  test("exhibit update with status change creates journal entry", async () => {
    await runWithDirectory(TMP, async () => {
      const createResult = await callExhibit("create", { title: "Journal test exhibit", kind: "figure" })
      const id = (createResult.metadata as any).id as string

      // Update status via update action
      await callExhibit("update", { id, force: true, status: "rendered" })

      const notes = await findStatusOverrideNotes(id)
      expect(notes.length).toBeGreaterThanOrEqual(1)

      const note = notes[notes.length - 1]!
      expect(note.kind).toBe("status_override")
      expect(note.importance).toBe("critical")
      expect(note.refs).toContain(id)
      expect(note.phase).toBe("compose")
    })
  })

  test("experiment update with status change creates journal entry", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await callExperiment("register", {
        title: "Journal test experiment all-types",
        authenticity: "evidence",
      })
      const id = (regResult.metadata as any).id as string

      await callExperiment("update", { id, force: true, status: "scheduled" })

      const notes = await findStatusOverrideNotes(id)
      expect(notes.length).toBeGreaterThanOrEqual(1)

      const note = notes[notes.length - 1]!
      expect(note.kind).toBe("status_override")
      expect(note.importance).toBe("critical")
      expect(note.refs).toContain(id)
      expect(note.phase).toBe("experiment")
    })
  })

  test("claim update with status change creates journal entry", async () => {
    await runWithDirectory(TMP, async () => {
      const claimR = await callClaim("create", { title: "Journal test claim all-types" })
      const id = (claimR.metadata as any).id as string

      await callClaim("update", { id, force: true, status: "weak" })

      const notes = await findStatusOverrideNotes(id)
      expect(notes.length).toBeGreaterThanOrEqual(1)

      const note = notes[notes.length - 1]!
      expect(note.kind).toBe("status_override")
      expect(note.importance).toBe("critical")
      expect(note.refs).toContain(id)
      expect(note.phase).toBe("compose")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Status override journal entry includes timeline event
// ══════════════════════════════════════════════════════════════════════════════

describe("status override timeline event", () => {
  test("experiment update appends entity.status_override timeline event", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await callExperiment("register", {
        title: "Timeline test",
        authenticity: "evidence",
      })
      const expId = (regResult.metadata as any).id as string

      await callExperiment("update", { id: expId, force: true, status: "scheduled" })

      // Read timeline and find the status_override event
      const timelinePath = ResearchFS.resolve("timeline.jsonl")
      const events = await ResearchFS.readJsonl<any>(timelinePath)
      const overrideEvent = events.find(
        (e: any) => e.type === "entity.status_override" && e.id === expId,
      )

      expect(overrideEvent).toBeDefined()
      expect(overrideEvent.phase).toBe("experiment")
      expect(overrideEvent.summary).toContain("status overridden")
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// No journal entry when update does not change status
// ══════════════════════════════════════════════════════════════════════════════

describe("no status_override when status unchanged", () => {
  test("experiment update without status change creates no status_override note", async () => {
    await runWithDirectory(TMP, async () => {
      const regResult = await callExperiment("register", {
        title: "No override test",
        authenticity: "evidence",
      })
      const expId = (regResult.metadata as any).id as string

      // Count override notes before
      const notesBefore = await findStatusOverrideNotes(expId)

      // Update a non-status field
      await callExperiment("update", { id: expId, metrics: { accuracy: 0.85 } })

      // Count override notes after — should be the same
      const notesAfter = await findStatusOverrideNotes(expId)
      expect(notesAfter.length).toBe(notesBefore.length)
    })
  })
})
