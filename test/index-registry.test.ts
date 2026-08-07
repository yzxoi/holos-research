import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import YAML from "yaml"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { loadIndex, bootstrapResearchIndex, registerIndexedFile, listIndexedYaml, installIndexHooks } from "../src/index-registry"
import { seedProject } from "./helpers"

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-index-test-${Date.now()}`)

beforeEach(async () => {
  initContext({ directory: TMP })
  installIndexHooks()
  await fs.mkdir(path.join(TMP, ".research"), { recursive: true })
})

afterEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {})
})

describe("index-registry: bootstrap from legacy project", () => {
  test("bootstraps entities, phase runs, diagnoses, journal from readdir", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP, {
        state: { project: "legacy" },
        extraFiles: ["ideas/idea_001.yaml", "plans/plan_002.yaml", "phase_runs/run_1.yaml", "diagnoses/diag_1.yaml"],
      })
      // Write actual YAML content for entity files so readYaml can parse them.
      await Bun.write(path.join(TMP, ".research", "ideas", "idea_001.yaml"), YAML.stringify({ id: "idea_001", title: "Idea A", status: "proposed", created: "2026-01-01" }))
      await Bun.write(path.join(TMP, ".research", "plans", "plan_002.yaml"), YAML.stringify({ id: "plan_002", title: "Plan B", status: "draft" }))
      await Bun.write(path.join(TMP, ".research", "phase_runs", "run_1.yaml"), YAML.stringify({ id: "run_1", phase: "explore", status: "active" }))

      const index = await loadIndex()
      expect(index.version).toBe(1)
      expect(index.entities.idea!.map((e) => e.id)).toEqual(["idea_001"])
      expect(index.entities.plan!.map((e) => e.id)).toEqual(["plan_002"])
      expect(index.phaseRuns.map((e) => e.id)).toEqual(["run_1"])
      expect(index.diagnoses.map((e) => e.file)).toEqual(["diagnoses/diag_1.yaml"])
    })
  })

  test("empty index when project not initialized", async () => {
    await runWithDirectory(undefined, async () => {
      const index = await bootstrapResearchIndex()
      expect(index.entities.idea).toEqual([])
      expect(index.phaseRuns).toEqual([])
    })
  })
})

describe("index-registry: register writes and list", () => {
  test("registerIndexedFile adds entity and listIndexedYaml returns it", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const rel = "ideas/idea_001.yaml"
      await registerIndexedFile(path.join(TMP, ".research", rel), { id: "idea_001", title: "Idea A", status: "proposed" })

      const files = await listIndexedYaml("ideas")
      expect(files).toEqual(["idea_001.yaml"])

      const index = await loadIndex()
      expect(index.entities.idea![0]!.file).toBe(rel)
      expect(index.entities.idea![0]!.status).toBe("proposed")
      expect(index.entities.idea![0]!.title).toBe("Idea A")
    })
  })

  test("registering same file twice updates entry, does not duplicate", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const abs = path.join(TMP, ".research", "ideas", "idea_001.yaml")
      await registerIndexedFile(abs, { id: "idea_001", status: "proposed" })
      await registerIndexedFile(abs, { id: "idea_001", status: "selected" })

      const index = await loadIndex()
      expect(index.entities.idea).toHaveLength(1)
      expect(index.entities.idea![0]!.status).toBe("selected")
    })
  })

  test("listYaml via ResearchFS uses index after install", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      await ResearchFS.writeYaml(ResearchFS.resolve("ideas", "idea_002.yaml"), { id: "idea_002", status: "draft" })
      const files = await ResearchFS.listYaml(ResearchFS.resolve("ideas"))
      expect(files).toEqual(["idea_002.yaml"])
    })
  })

  test("aux dir registration (positioning) round-trips", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const abs = path.join(TMP, ".research", "positioning", "story_1.story.yaml")
      await registerIndexedFile(abs, {})
      const files = await listIndexedYaml("positioning")
      expect(files).toEqual(["story_1.story.yaml"])
    })
  })
})

describe("index-registry: corruption tolerance", () => {
  test("invalid index.yaml treated as missing and bootstrapped", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP, { extraFiles: ["ideas/idea_003.yaml"] })
      await Bun.write(path.join(TMP, ".research", "index.yaml"), "not: [valid: yaml")
      const index = await loadIndex()
      expect(index.entities.idea!.map((e) => e.id)).toEqual(["idea_003"])
    })
  })
})
