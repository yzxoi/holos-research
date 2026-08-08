import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import type { PluginInvocationContext } from "@ericsanchezok/synergy-plugin"
import path from "node:path"
import fs from "node:fs/promises"
import { initContext, runWithDirectory } from "../src/ctx"
import { installIndexHooks } from "../src/index-registry"
import {
  monitorAll,
  monitorWorkflow,
  monitorEntities,
  monitorTimeline,
  monitorJournal,
  monitorActiveRun,
  monitorBrief,
} from "../src/operations"
import { seedProject, stubWorkspace } from "./helpers"

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-ops-test-${Date.now()}`)

/** Build a PluginInvocationContext stub carrying the workspace Host Service. */
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

beforeEach(async () => {
  initContext({ directory: TMP, workspace: stubWorkspace(TMP) })
  installIndexHooks()
  await fs.mkdir(path.join(TMP, ".research"), { recursive: true })
})

afterEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {})
})

describe("monitor operations (UI data contract)", () => {
  test("monitor.all returns the combined dashboard snapshot", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP, { state: { project: "Ops Test", focus: { phase: "explore", since: "2026-01-01T00:00:00Z" } } })
      const data = (await monitorAll.handler({}, makeCtx())) as Record<string, unknown>
      expect(data).toHaveProperty("workflow")
      expect(data).toHaveProperty("entities")
      expect(data).toHaveProperty("entityRecords")
      expect(data).toHaveProperty("timeline")
      expect(data).toHaveProperty("journal")
      expect(data).toHaveProperty("activeRun")
      expect(data).toHaveProperty("phaseDetailsMap")
      expect(data).toHaveProperty("phaseRuns")
      const workflow = data.workflow as { current_phase: string | null; phases: unknown[] }
      expect(workflow.current_phase).toBe("explore")
      expect(workflow.phases.length).toBe(6)
    })
  })

  test("monitor.workflow returns phase status", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const wf = (await monitorWorkflow.handler({}, makeCtx())) as { phases: unknown[]; current_phase: string | null }
      expect(wf.phases.length).toBe(6)
    })
  })

  test("monitor.entities returns counts and focus refs", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const entities = (await monitorEntities.handler({}, makeCtx())) as {
        counts: Record<string, number>
        focus_refs: Record<string, unknown>
      }
      expect(entities.counts.ideas).toBe(0)
      expect(entities.counts.plans).toBe(0)
      expect(entities.focus_refs).toBeDefined()
    })
  })

  test("monitor.timeline returns events with limit", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP, { extraFiles: ["ideas/idea_001.yaml"] })
      await Bun.write(
        path.join(TMP, ".research", "timeline.jsonl"),
        JSON.stringify({ ts: "2026-01-01T00:00:00Z", type: "idea.created", summary: "first" }) + "\n" +
          JSON.stringify({ ts: "2026-01-02T00:00:00Z", type: "idea.created", summary: "second" }) + "\n",
      )
      const tl = (await monitorTimeline.handler({ limit: 1 }, makeCtx())) as { events: unknown[] }
      expect(tl.events.length).toBe(1)
    })
  })

  test("monitor.journal returns notes", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const j = (await monitorJournal.handler({}, makeCtx())) as { notes: unknown[] }
      expect(Array.isArray(j.notes)).toBe(true)
    })
  })

  test("monitor.activeRun returns run without raw state", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const ar = (await monitorActiveRun.handler({}, makeCtx())) as Record<string, unknown>
      expect(ar).not.toHaveProperty("state")
      expect(ar).toHaveProperty("run")
      expect(ar).toHaveProperty("context")
    })
  })

  test("monitor.brief returns a research brief", async () => {
    await runWithDirectory(undefined, async () => {
      await seedProject(TMP)
      const brief = (await monitorBrief.handler({}, makeCtx())) as { summary?: string; items?: unknown[] }
      expect(brief).toBeDefined()
    })
  })

  test("uninitialized project returns empty payload (panel empty state)", async () => {
    await runWithDirectory(undefined, async () => {
      const data = (await monitorAll.handler({}, makeCtx())) as Record<string, unknown>
      expect(data.workflow).toBeNull()
      expect(data.entities).toMatchObject({ counts: { ideas: 0 } })
      expect(data.entityRecords).toEqual([])
      expect(data.phaseRuns).toEqual([])
    })
  })

  test("missing workspace directory throws structured error", async () => {
    await runWithDirectory(undefined, async () => {
      const ctx = makeCtx()
      ctx.workspace = { metadata: async () => ({ scopeId: "x" }) }
      await expect(monitorAll.handler({}, ctx)).rejects.toThrow(/no directory/)
    })
  })
})
