import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { SnapshotManager } from "../src/snapshot"
import { ResearchJournal } from "../src/journal"
import { ResearchFS } from "../src/fs"
import { seedProject, stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Setup helpers ─────────────────────────────────────────────────────────────

function makeTmp(suffix: string) {
  return path.join(process.env.TMPDIR || "/tmp", `holos-snap-journal-test-${suffix}-${Date.now()}`)
}

async function cleanup(tmp: string) {
  await fs.rm(tmp, { recursive: true, force: true })
}

// Helper: read journal lines from the JSONL file
async function readJournalLines(): Promise<any[]> {
  const filePath = ResearchFS.resolve("journal/research_notes.jsonl")
  const content = await Bun.file(filePath).text()
  return content.trim().split("\n").filter(Boolean).map((line: string) => JSON.parse(line))
}

// ── SnapshotManager tests ─────────────────────────────────────────────────────

describe("SnapshotManager", () => {
  const TMP = makeTmp("snap")
  beforeAll(async () => { initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any }); await seedProject(TMP, { state: { project: "snapshot-journal-test" } }) })
  afterAll(async () => { await cleanup(TMP) })

  test("create snapshot writes manifest.yaml", async () => {
    await runWithDirectory(undefined, async () => {
      const manifest = await SnapshotManager.create({
        trigger: "manual",
        phase: "explore",
        summary: "test snapshot",
        refs: { state: "state.yaml" },
      })
      const manifestFile = SnapshotManager.manifestPath(manifest.id)
      const exists = await fs.access(manifestFile).then(() => true, () => false)
      expect(exists).toBe(true)
    })
  })

  test("snapshot manifest includes trigger and phase", async () => {
    await runWithDirectory(undefined, async () => {
      const manifest = await SnapshotManager.create({
        trigger: "checkpoint.confirmed",
        phase: "design",
        summary: "checkpoint snapshot",
        refs: { state: "state.yaml" },
      })
      expect(manifest.trigger).toBe("checkpoint.confirmed")
      expect(manifest.phase).toBe("design")
    })
  })

  test("snapshot copies referenced files", async () => {
    await runWithDirectory(undefined, async () => {
      // Create a file to be referenced and copied
      const testData = { test: "data" }
      await ResearchFS.writeYaml(ResearchFS.resolve("state.yaml"), testData)

      const manifest = await SnapshotManager.create({
        trigger: "manual",
        summary: "copy refs test",
        refs: { state: "state.yaml" },
        copyRefs: true,
      })
      const snapDir = SnapshotManager.resolveDir(manifest.id)
      const copiedFile = path.join(snapDir, "state.yaml")
      const exists = await fs.access(copiedFile).then(() => true, () => false)
      expect(exists).toBe(true)
    })
  })

  test("create multiple snapshots", async () => {
    await runWithDirectory(undefined, async () => {
      const snap1 = await SnapshotManager.create({
        trigger: "manual",
        phase: "explore",
        summary: "first snapshot",
        refs: { state: "state.yaml" },
      })
      // IDs are second-granularity — wait to ensure different IDs
      await new Promise(r => setTimeout(r, 1100))
      const snap2 = await SnapshotManager.create({
        trigger: "manual",
        phase: "design",
        summary: "second snapshot",
        refs: { state: "state.yaml" },
      })
      expect(snap1.id).not.toBe(snap2.id)
      const mf1 = await fs.access(SnapshotManager.manifestPath(snap1.id)).then(() => true, () => false)
      const mf2 = await fs.access(SnapshotManager.manifestPath(snap2.id)).then(() => true, () => false)
      expect(mf1).toBe(true)
      expect(mf2).toBe(true)
    })
  })

  test("snapshot with refs records them in manifest", async () => {
    await runWithDirectory(undefined, async () => {
      // Use non-critical refs only — critical refs like "phase_run" must exist on disk
      const refs = { state: "state.yaml", idea: "ideas/idea_001.yaml" }
      const manifest = await SnapshotManager.create({
        trigger: "manual",
        summary: "refs test",
        refs,
      })
      expect(manifest.refs).toEqual(refs)
      // Non-critical missing ref gets "missing" hash
      expect(manifest.artifact_hashes.idea).toBe("missing")
    })
  })

  test("restore snapshot recovers files", async () => {
    await runWithDirectory(undefined, async () => {
      // Write initial content
      const originalState = { project: "original", created: new Date().toISOString() }
      await ResearchFS.writeYaml(ResearchFS.resolve("state.yaml"), originalState)

      // Create snapshot with copyRefs
      const manifest = await SnapshotManager.create({
        trigger: "manual",
        summary: "restore test",
        refs: { state: "state.yaml" },
        copyRefs: true,
      })

      // Modify the file
      const modifiedState = { project: "modified", created: new Date().toISOString() }
      await ResearchFS.writeYaml(ResearchFS.resolve("state.yaml"), modifiedState)

      // Restore
      const result = await SnapshotManager.restore(manifest.id)
      expect(result.copiedFiles).toContain("state")

      // Verify file is recovered
      const restored = await ResearchFS.readYaml<{ project: string }>(ResearchFS.resolve("state.yaml"))
      expect(restored?.project).toBe("original")
    })
  })

  test("restore non-existent snapshot returns error", async () => {
    await runWithDirectory(undefined, async () => {
      await expect(SnapshotManager.restore("snap_nonexistent")).rejects.toThrow(/not found/)
    })
  })

  test("snapshot manifest has timestamp", async () => {
    await runWithDirectory(undefined, async () => {
      const manifest = await SnapshotManager.create({
        trigger: "manual",
        summary: "timestamp test",
        refs: { state: "state.yaml" },
      })
      expect(manifest.created).toBeTruthy()
      // Verify it's a valid ISO date string
      expect(new Date(manifest.created).toISOString()).toBe(manifest.created)
    })
  })
})

// ── ResearchJournal tests ─────────────────────────────────────────────────────

describe("ResearchJournal", () => {
  const TMP = makeTmp("journal")
  beforeAll(async () => { initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any }); await seedProject(TMP, { state: { project: "snapshot-journal-test" } }) })
  afterAll(async () => { await cleanup(TMP) })

  test("appendAgentNote writes to journal", async () => {
    await runWithDirectory(undefined, async () => {
      const note = await ResearchJournal.appendAgentNote({
        kind: "design_note",
        summary: "test agent note",
        note: "This is an agent note for testing",
      })
      expect(note.id).toBeTruthy()
      expect(note.summary).toBe("test agent note")

      const lines = await readJournalLines()
      expect(lines.length).toBeGreaterThanOrEqual(1)
      const written = lines[lines.length - 1]
      expect(written.summary).toBe("test agent note")
    })
  })

  test("appendAgentNote with refs", async () => {
    await runWithDirectory(undefined, async () => {
      const note = await ResearchJournal.appendAgentNote({
        kind: "experiment_note",
        summary: "note with refs",
        note: "Testing refs",
        refs: ["exp_001", "claim_002"],
      })
      expect(note.refs).toEqual(["exp_001", "claim_002"])
    })
  })

  test("appendHumanDecision writes to journal", async () => {
    await runWithDirectory(undefined, async () => {
      const note = await ResearchJournal.appendHumanDecision({
        kind: "decision_rationale",
        summary: "human decided to proceed",
        note: "The results look promising, let's continue",
      })
      expect(note.author).toBe("human")
      expect(note.importance).toBe("critical")
      expect(note.summary).toBe("human decided to proceed")
    })
  })

  test("multiple notes are ordered", async () => {
    await runWithDirectory(undefined, async () => {
      // Clear the file first to get a clean slate
      const filePath = ResearchFS.resolve("journal/research_notes.jsonl")
      await Bun.write(filePath, "")

      // Reset the journal counter by re-initializing context (counter is module-level)
      // We can't reset the module counter, so we rely on reading the file
      await ResearchJournal.appendAgentNote({
        kind: "design_note",
        summary: "first note",
        note: "First",
      })
      await ResearchJournal.appendAgentNote({
        kind: "design_note",
        summary: "second note",
        note: "Second",
      })
      await ResearchJournal.appendAgentNote({
        kind: "design_note",
        summary: "third note",
        note: "Third",
      })

      const lines = await readJournalLines()
      // Filter to the notes we just wrote (by summary)
      const ourNotes = lines.filter((l: any) => ["first note", "second note", "third note"].includes(l.summary))
      expect(ourNotes.length).toBe(3)
      expect(ourNotes[0].summary).toBe("first note")
      expect(ourNotes[1].summary).toBe("second note")
      expect(ourNotes[2].summary).toBe("third note")
    })
  })

  test("journal entry has timestamp", async () => {
    await runWithDirectory(undefined, async () => {
      const note = await ResearchJournal.appendAgentNote({
        kind: "idea_rationale",
        summary: "timestamp test",
        note: "Checking timestamp",
      })
      expect(note.ts).toBeTruthy()
      // Verify it's a valid ISO date string
      expect(new Date(note.ts).toISOString()).toBe(note.ts)
    })
  })

  test("journal entry has kind field", async () => {
    await runWithDirectory(undefined, async () => {
      const note = await ResearchJournal.appendAgentNote({
        kind: "failure_analysis",
        summary: "kind field test",
        note: "Checking kind",
      })
      expect(note.kind).toBe("failure_analysis")
    })
  })
})
