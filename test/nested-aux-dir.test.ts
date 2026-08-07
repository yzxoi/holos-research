import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import type { PluginInvocationContext } from "@ericsanchezok/synergy-plugin"
import path from "node:path"
import fs from "node:fs/promises"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { installIndexHooks } from "../src/index-registry"
import { researchIdea } from "../src/tools/idea"
import { researchWiki } from "../src/tools/wiki"
import { seedProject, stubWorkspace } from "./helpers"

/**
 * Regression test for the nested AUX_DIRS bucket mismatch:
 * after index.yaml exists (created by any entity write), a paper ingested
 * under literature/papers/<slug>.yaml must be registered in
 * files["literature/papers"] (not files["literature"]) so that
 * research_wiki stats/lint/query still see it.
 *
 * Repro before the fix: bucketFor() keyed on parts[0] only, so writes to
 * literature/papers/x.yaml landed in files["literature"] while
 * listIndexedYaml("literature/papers") read files["literature/papers"].
 */

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-nested-aux-test-${Date.now()}`)

function makeCtx(): PluginInvocationContext {
  return {
    requestId: "test-request",
    scopeId: "test-scope",
    runtime: { hostVersion: "test", pluginVersion: "1.0.0", pluginGeneration: "test", protocolVersion: 4 },
    actor: { type: "ui" },
    signal: new AbortController().signal,
    log: { debug() {}, info() {}, warn() {}, error() {} },
    events: { publish: async () => {} },
    workspace: stubWorkspace(TMP),
  } as PluginInvocationContext
}

async function callIdea(action: string, params: Record<string, unknown> = {}, ctx: PluginInvocationContext) {
  return researchIdea.execute({ action, ...params } as never, ctx as never)
}

async function callWiki(action: string, params: Record<string, unknown> = {}, ctx: PluginInvocationContext) {
  return researchWiki.execute({ action, ...params } as never, ctx as never)
}

beforeEach(async () => {
  initContext({ directory: TMP, workspace: stubWorkspace(TMP) })
  installIndexHooks()
  await fs.mkdir(path.join(TMP, ".research"), { recursive: true })
})

afterEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {})
})

describe("nested aux dirs (literature/papers) with existing index.yaml", () => {
  test("wiki stats and lint see papers after an entity write creates index.yaml", async () => {
    await runWithDirectory(undefined, async () => {
      const ctx = makeCtx()
      await seedProject(TMP)

      // 1. Entity write → creates .research/index.yaml (production order:
      //    research_init → research_idea → wiki ingest).
      const idea = (await callIdea("create", { title: "Nested Aux Idea" }, ctx)) as { metadata?: Record<string, unknown> }
      expect(idea.metadata?.id).toBeTruthy()
      const indexExists = await ResearchFS.exists(ResearchFS.resolve("index.yaml"))
      expect(indexExists).toBe(true)

      // 2. Ingest a paper → writes literature/papers/<slug>.yaml.
      const ingest = (await callWiki("ingest_paper", { title: "Nested Aux Paper", authors: ["Nested"], year: 2026 }, ctx)) as {
        output: string
        metadata?: Record<string, unknown>
      }
      expect(ingest.output).toContain("✅")
      const slug = ingest.metadata?.slug as string
      expect(slug).toBeTruthy()

      // 3. listYaml("literature/papers") must list the paper via the index.
      const files = await ResearchFS.listYaml(ResearchFS.resolve("literature/papers"))
      expect(files).toContain(`${slug}.yaml`)

      // 4. research_wiki stats counts the paper.
      const stats = (await callWiki("stats", {}, ctx)) as { output: string; metadata?: Record<string, unknown> }
      expect(stats.output).toContain("Papers:")
      expect((stats.metadata as Record<string, unknown>)?.papers ?? 0).toBeGreaterThanOrEqual(1)

      // 5. research_wiki lint flags the paper as orphan (no edges).
      const lint = (await callWiki("lint", {}, ctx)) as { output: string }
      expect(lint.output).toContain("ORPHAN")
    })
  })

  test("top-level literature files still register under files[literature]", async () => {
    await runWithDirectory(undefined, async () => {
      const ctx = makeCtx()
      await seedProject(TMP)
      await callIdea("create", { title: "Top-Level Literature Idea" }, ctx)

      // gap_map.yaml lives at literature/gap_map.yaml (top-level aux dir).
      await ResearchFS.writeYaml(ResearchFS.resolve("literature/gap_map.yaml"), { gaps: [] })
      const files = await ResearchFS.listYaml(ResearchFS.resolve("literature"))
      expect(files).toContain("gap_map.yaml")
    })
  })
})
