import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS, YamlCorruptError, JsonlCorruptError } from "../src/fs"
import { corruptFileResult, withGuard } from "../src/tools/shared"
import { stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── Setup ────────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-corrupt-test-${Date.now()}`)

async function initWithProject() {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  const researchDir = path.join(TMP, ".research")
  await fs.mkdir(path.join(researchDir, "ideas"), { recursive: true })
  await fs.mkdir(path.join(researchDir, "plans"), { recursive: true })
  await fs.mkdir(path.join(researchDir, "experiments"), { recursive: true })
  await fs.mkdir(path.join(researchDir, "claims"), { recursive: true })
  await fs.mkdir(path.join(researchDir, "literature", "papers"), { recursive: true })

  const state = {
    project: "test-project",
    anchor: "Shared KV cache for causal attention",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    config: { participation_mode: "collaborative" },
    counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
  }
  await Bun.write(path.join(researchDir, "state.yaml"), YAML.stringify(state))
}

async function cleanup() {
  await fs.rm(TMP, { recursive: true, force: true })
}

// ── readYaml: file not found vs corrupt ──────────────────────────────────────

describe("readYaml corruption detection", () => {
  beforeAll(initWithProject)
  afterAll(cleanup)

  test("returns undefined for nonexistent file", async () => {
    await runWithDirectory(undefined, async () => {
      const result = await ResearchFS.readYaml(ResearchFS.resolve("nonexistent.yaml"))
      expect(result).toBeUndefined()
    })
  })

  test("throws YamlCorruptError for file with invalid YAML", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("ideas", "idea_bad.yaml")
      await Bun.write(p, "id: idea_bad\ntitle: [unterminated bracket\nstatus: proposed")

      try {
        await ResearchFS.readYaml(p)
        expect(true).toBe(false) // should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(YamlCorruptError)
        expect((err as YamlCorruptError).filePath).toBe(p)
        expect((err as YamlCorruptError).parseError).toBeTruthy()
      }
    })
  })

  test("reads valid YAML normally", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("ideas", "idea_good.yaml")
      await ResearchFS.writeYaml(p, { id: "idea_good", title: "Good", status: "proposed" })
      const data = await ResearchFS.readYaml<{ id: string }>(p)
      expect(data?.id).toBe("idea_good")
    })
  })

  test("throws YamlCorruptError for truly unparseable content", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("plans", "plan_garbled.yaml")
      // Tabs in YAML flow context cause a real parse error
      await Bun.write(p, "key:\n\t- bad indent\n  - mixed")

      try {
        await ResearchFS.readYaml(p)
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(YamlCorruptError)
      }
    })
  })

  test("handles empty file gracefully (valid YAML, parses to null)", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("ideas", "idea_empty.yaml")
      await Bun.write(p, "")
      // Empty string parses to null in YAML, not an error
      const data = await ResearchFS.readYaml(p)
      expect(data).toBeNull()
    })
  })
})

// ── readJsonl: corruption detection ──────────────────────────────────────────

describe("readJsonl corruption detection", () => {
  beforeAll(initWithProject)
  afterAll(cleanup)

  test("returns empty array for nonexistent file", async () => {
    await runWithDirectory(undefined, async () => {
      const entries = await ResearchFS.readJsonl(ResearchFS.resolve("nonexistent.jsonl"))
      expect(entries).toEqual([])
    })
  })

  test("throws JsonlCorruptError for line with invalid JSON", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("corrupt.jsonl")
      await Bun.write(p, '{"valid": true}\n{broken json\n{"also": "valid"}\n')

      try {
        await ResearchFS.readJsonl(p)
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(JsonlCorruptError)
        expect((err as JsonlCorruptError).line).toBe(2) // line 2 is broken
      }
    })
  })

  test("reads valid JSONL normally", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("valid.jsonl")
      await Bun.write(p, '{"a": 1}\n{"a": 2}\n')
      const entries = await ResearchFS.readJsonl<{ a: number }>(p)
      expect(entries).toHaveLength(2)
      expect(entries[0].a).toBe(1)
    })
  })

  test("skips blank lines without error", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("blanks.jsonl")
      await Bun.write(p, '{"a": 1}\n\n\n{"a": 2}\n\n')
      const entries = await ResearchFS.readJsonl<{ a: number }>(p)
      expect(entries).toHaveLength(2)
    })
  })
})

// ── corruptFileResult: schema hints ──────────────────────────────────────────

describe("corruptFileResult schema hints", () => {
  test("state.yaml error includes state fields", () => {
    const err = new YamlCorruptError("/project/.research/state.yaml", "bad indent")
    const result = corruptFileResult(err)
    expect(result).toBeTruthy()
    expect(result!.output).toContain("project: string")
    expect(result!.output).toContain("counters")
    expect(result!.output).toContain("DO NOT call research_init")
  })

  test("idea YAML error includes idea fields", () => {
    const err = new YamlCorruptError("/project/.research/ideas/idea_003.yaml", "bad")
    const result = corruptFileResult(err)
    expect(result!.output).toContain("status: one of")
    expect(result!.output).toContain("proposed")
  })

  test("experiment YAML error includes experiment fields", () => {
    const err = new YamlCorruptError("/project/.research/experiments/exp_007.yaml", "bad")
    const result = corruptFileResult(err)
    expect(result!.output).toContain("registered")
    expect(result!.output).toContain("completed")
  })

  test("claim YAML error includes claim fields", () => {
    const err = new YamlCorruptError("/project/.research/claims/claim_001.yaml", "bad")
    const result = corruptFileResult(err)
    expect(result!.output).toContain("candidate")
    expect(result!.output).toContain("supported")
  })

  test("literature paper YAML error includes paper fields", () => {
    const err = new YamlCorruptError("/project/.research/literature/papers/smith2025.yaml", "bad")
    const result = corruptFileResult(err)
    expect(result!.output).toContain("slug")
    expect(result!.output).toContain("relevance")
  })

  test("unknown file path gives generic hint", () => {
    const err = new YamlCorruptError("/project/.research/unknown/stuff.yaml", "bad")
    const result = corruptFileResult(err)
    expect(result!.output).toContain("Read other YAML files")
  })

  test("JSONL error includes line number and repair guidance", () => {
    const err = new JsonlCorruptError("/project/.research/timeline.jsonl", 42, "Unexpected token")
    const result = corruptFileResult(err)
    expect(result!.output).toContain("line 42")
    expect(result!.output).toContain("valid JSON object")
  })

  test("non-corruption error returns undefined", () => {
    expect(corruptFileResult(new Error("random error"))).toBeUndefined()
    expect(corruptFileResult("string error")).toBeUndefined()
    expect(corruptFileResult(null)).toBeUndefined()
  })
})

// ── withGuard: wrapping behavior ─────────────────────────────────────────────

describe("withGuard", () => {
  test("passes through normal results", async () => {
    const result = await withGuard(async () => ({
      title: "OK",
      output: "success",
    }))
    expect(result.title).toBe("OK")
  })

  test("catches YamlCorruptError and returns repair result", async () => {
    const result = await withGuard(async () => {
      throw new YamlCorruptError("/project/.research/state.yaml", "indent error")
    })
    expect(result.title).toBe("Corrupt YAML")
    expect(result.output).toContain("indent error")
    expect(result.output).toContain("DO NOT call research_init")
  })

  test("catches JsonlCorruptError and returns repair result", async () => {
    const result = await withGuard(async () => {
      throw new JsonlCorruptError("/project/.research/timeline.jsonl", 5, "bad token")
    })
    expect(result.title).toBe("Corrupt JSONL")
    expect(result.output).toContain("line 5")
  })

  test("re-throws non-corruption errors", async () => {
    try {
      await withGuard(async () => {
        throw new Error("something else")
      })
      expect(true).toBe(false)
    } catch (err) {
      expect((err as Error).message).toBe("something else")
    }
  })
})

// ── Backward compatibility: state.yaml without anchor ────────────────────────

describe("backward compatibility", () => {
  beforeAll(initWithProject)
  afterAll(cleanup)

  test("state.yaml without anchor field parses normally", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("state.yaml")
      const stateWithoutAnchor = {
        project: "legacy-project",
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
        config: { participation_mode: "collaborative" },
        counters: { idea: 3, plan: 1, exp: 5, claim: 0, exh: 0, paper: 0, sub: 0 },
      }
      await ResearchFS.writeYaml(p, stateWithoutAnchor)
      const data = await ResearchFS.readYaml<{ project: string; anchor?: string }>(p)
      expect(data?.project).toBe("legacy-project")
      expect(data?.anchor).toBeUndefined()
    })
  })

  test("state.yaml with anchor field parses correctly", async () => {
    await runWithDirectory(undefined, async () => {
      const p = ResearchFS.resolve("state.yaml")
      const stateWithAnchor = {
        project: "new-project",
        anchor: "Shared KV cache for causal attention",
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
        config: { participation_mode: "collaborative" },
        counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
      }
      await ResearchFS.writeYaml(p, stateWithAnchor)
      const data = await ResearchFS.readYaml<{ project: string; anchor?: string }>(p)
      expect(data?.anchor).toBe("Shared KV cache for causal attention")
    })
  })
})
