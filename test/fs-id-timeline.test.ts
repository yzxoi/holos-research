import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { ResearchId } from "../src/id"
import { ResearchTimeline } from "../src/timeline"
import { stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Setup helpers ─────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-test-${Date.now()}`)

async function initWithProject() {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await runWithDirectory(undefined, async () => {
    const researchDir = path.join(TMP, ".research")
    await fs.mkdir(researchDir, { recursive: true })
    await fs.mkdir(path.join(researchDir, "ideas"), { recursive: true })
    await fs.mkdir(path.join(researchDir, "plans"), { recursive: true })
    await fs.mkdir(path.join(researchDir, "experiments"), { recursive: true })
    await fs.mkdir(path.join(researchDir, "claims"), { recursive: true })
    await fs.mkdir(path.join(researchDir, "exhibits"), { recursive: true })
    await fs.mkdir(path.join(researchDir, "papers"), { recursive: true })
    await fs.mkdir(path.join(researchDir, "submissions"), { recursive: true })
    await fs.mkdir(path.join(researchDir, "literature"), { recursive: true })

    const state = {
      project: "test-project",
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

// ── ResearchFS ────────────────────────────────────────────────────────────────

describe("ResearchFS", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("resolve constructs correct path", async () => {
    await runWithDirectory(undefined, async () => {
      expect(ResearchFS.resolve("ideas", "idea_001.yaml")).toBe(
        path.join(TMP, ".research", "ideas", "idea_001.yaml"),
      )
    })
  })

  test("exists returns true for existing file", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("state.yaml")
      expect(await ResearchFS.exists(p)).toBe(true)
    })
  })

  test("exists returns false for missing file", async () => {
    await runWithDirectory(undefined, async () => {
      expect(await ResearchFS.exists(ResearchFS.resolve("nonexistent.yaml"))).toBe(false)
    })
  })

  test("writeYaml + readYaml round-trip", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("ideas", "test.yaml")
      const data = { id: "idea_001", title: "Test Idea", status: "proposed" }
      await ResearchFS.writeYaml(p, data)
      const read = await ResearchFS.readYaml<typeof data>(p)
      expect(read).toEqual(data)
    })
  })

  test("readYaml returns undefined for missing file", async () => {
    await runWithDirectory(undefined, async () => {
      const read = await ResearchFS.readYaml(ResearchFS.resolve("missing.yaml"))
      expect(read).toBeUndefined()
    })
  })

  test("appendJsonl + readJsonl round-trip", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("test.jsonl")
      await ResearchFS.appendJsonl(p, { type: "test", value: 1 })
      await ResearchFS.appendJsonl(p, { type: "test", value: 2 })
      const entries = await ResearchFS.readJsonl<{ type: string; value: number }>(p)
      expect(entries).toHaveLength(2)
      expect(entries[0].value).toBe(1)
      expect(entries[1].value).toBe(2)
    })
  })

  test("isInitialized returns true when state.yaml exists", async () => {
    await runWithDirectory(undefined, async () => {
      expect(await ResearchFS.isInitialized()).toBe(true)
    })
  })

  test("listYaml returns sorted yaml filenames", async () => {
    await runWithDirectory(undefined, async () => {
      const dir = ResearchFS.resolve("plans")
      await ResearchFS.writeYaml(path.join(dir, "plan_002.yaml"), { id: "plan_002" })
      await ResearchFS.writeYaml(path.join(dir, "plan_001.yaml"), { id: "plan_001" })
      const files = await ResearchFS.listYaml(dir)
      expect(files).toEqual(["plan_001.yaml", "plan_002.yaml"])
    })
  })
})

// ── ResearchId ────────────────────────────────────────────────────────────────

describe("ResearchId", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("sequential IDs increment correctly", async () => {
    await runWithDirectory(undefined, async () => {
      const id1 = await ResearchId.next("idea")
      const id2 = await ResearchId.next("idea")
      const id3 = await ResearchId.next("idea")
      expect(id1).toBe("idea_001")
      expect(id2).toBe("idea_002")
      expect(id3).toBe("idea_003")
    })
  })

  test("different prefixes maintain separate counters", async () => {
    await runWithDirectory(undefined, async () => {
      const idea = await ResearchId.next("idea")
      const exp = await ResearchId.next("exp")
      expect(idea).toMatch(/^idea_\d{3}$/)
      expect(exp).toMatch(/^exp_\d{3}$/)
    })
  })

  test("IDs are zero-padded to 3 digits", async () => {
    await runWithDirectory(undefined, async () => {
      const id = await ResearchId.next("claim")
      expect(id).toMatch(/_\d{3}$/)
    })
  })
})

// ── ResearchTimeline ──────────────────────────────────────────────────────────

describe("ResearchTimeline", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("append and query events", async () => {
    await runWithDirectory(undefined, async () => {
      await ResearchTimeline.append({ type: "idea.created", id: "idea_001", summary: "Created idea" })
      await ResearchTimeline.append({ type: "idea.status", id: "idea_001", from: "proposed", to: "exploring", summary: "Moved to exploring" })

      const all = await ResearchTimeline.query()
      expect(all.length).toBeGreaterThanOrEqual(2)
    })
  })

  test("filter by type pattern", async () => {
    await runWithDirectory(undefined, async () => {
      await ResearchTimeline.append({ type: "idea.created", id: "idea_099", summary: "test" })
      await ResearchTimeline.append({ type: "exp.created", id: "exp_099", summary: "test" })

      const ideaEvents = await ResearchTimeline.query({ type: "idea.*" })
      expect(ideaEvents.every((e) => e.type.startsWith("idea"))).toBe(true)
    })
  })

  test("filter by refs", async () => {
    await runWithDirectory(undefined, async () => {
      await ResearchTimeline.append({ type: "idea.status", id: "idea_REF", summary: "ref test" })
      await ResearchTimeline.append({ type: "exp.status", id: "exp_REF", summary: "other" })

      const filtered = await ResearchTimeline.query({ refs: ["idea_REF"] })
      expect(filtered.some((e) => e.id === "idea_REF")).toBe(true)
    })
  })

  test("filter by last N", async () => {
    await runWithDirectory(undefined, async () => {
      await ResearchTimeline.append({ type: "milestone", summary: "m1" })
      await ResearchTimeline.append({ type: "milestone", summary: "m2" })
      await ResearchTimeline.append({ type: "milestone", summary: "m3" })

      const last2 = await ResearchTimeline.query({ type: "milestone", last: 2 })
      expect(last2).toHaveLength(2)
    })
  })
})
