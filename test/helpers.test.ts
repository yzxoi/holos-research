import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { resolveFocusRefs, loadDiagnosisReports } from "../src/helpers"
import { initContext, runWithDirectory } from "../src/ctx"
import { ResearchFS } from "../src/fs"
import { stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

// ── resolveFocusRefs ──────────────────────────────────────────────────────────

describe("resolveFocusRefs", () => {
  test("empty refs returns empty object", () => {
    const result = resolveFocusRefs(undefined, undefined)
    expect(result).toEqual({})
  })

  test("state refs only", () => {
    const result = resolveFocusRefs(
      { idea_ref: "idea_001", plan_ref: "plan_001" },
      undefined
    )
    expect(result).toEqual({ idea_ref: "idea_001", plan_ref: "plan_001" })
  })

  test("run refs only", () => {
    const result = resolveFocusRefs(
      undefined,
      { idea_ref: "idea_002", plan_ref: "plan_002" }
    )
    expect(result).toEqual({ idea_ref: "idea_002", plan_ref: "plan_002" })
  })

  test("run refs override state refs", () => {
    const result = resolveFocusRefs(
      { idea_ref: "idea_001", plan_ref: "plan_001" },
      { idea_ref: "idea_002" }
    )
    expect(result).toEqual({ idea_ref: "idea_002", plan_ref: "plan_001" })
  })

  test("arrays from run override arrays from state", () => {
    const result = resolveFocusRefs(
      { experiment_refs: ["exp_001", "exp_002"] },
      { experiment_refs: ["exp_003"] }
    )
    expect(result).toEqual({ experiment_refs: ["exp_003"] })
  })

  test("undefined values are excluded", () => {
    const result = resolveFocusRefs(
      { idea_ref: undefined, plan_ref: "plan_001" },
      { idea_ref: undefined }
    )
    expect(result).toEqual({ plan_ref: "plan_001" })
  })

  test("state arrays preserved when run does not override", () => {
    const result = resolveFocusRefs(
      { experiment_refs: ["exp_001"], claim_refs: ["claim_001"] },
      { claim_refs: ["claim_002"] }
    )
    expect(result).toEqual({
      experiment_refs: ["exp_001"],
      claim_refs: ["claim_002"],
    })
  })

  test("mixed string and array refs merge correctly", () => {
    const result = resolveFocusRefs(
      { idea_ref: "idea_001", experiment_refs: ["exp_001"] },
      { plan_ref: "plan_001", experiment_refs: ["exp_002", "exp_003"] }
    )
    expect(result).toEqual({
      idea_ref: "idea_001",
      experiment_refs: ["exp_002", "exp_003"],
      plan_ref: "plan_001",
    })
  })
})

// ── loadDiagnosisReports ─────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-helpers-test-${Date.now()}`)

async function initWithProject() {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await runWithDirectory(undefined, async () => {
    const researchDir = path.join(TMP, ".research")
    await fs.mkdir(researchDir, { recursive: true })
    await fs.mkdir(path.join(researchDir, "diagnoses"), { recursive: true })
  })
}

async function cleanup() {
  await fs.rm(TMP, { recursive: true, force: true })
}

describe("loadDiagnosisReports", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("empty directory returns empty array", async () => {
    await runWithDirectory(undefined, async () => {
      const reports = await loadDiagnosisReports()
      expect(reports).toEqual([])
    })
  })

  test("loads valid diagnosis files with diag_ prefix", async () => {
    await runWithDirectory(undefined, async () => {
      const diagData = {
        id: "diag_001",
        experiment_refs: ["exp_001"],
        levels: {
          L1_training_health: { status: "pass", evidence: "Loss converged" },
        },
        conclusion: {
          likely_cause: "none",
          recommended_decision: "iterate",
        },
      }
      await ResearchFS.writeYaml(
        ResearchFS.resolve("diagnoses", "diag_001.yaml"),
        diagData
      )
      const reports = await loadDiagnosisReports()
      expect(reports).toHaveLength(1)
      expect(reports[0].id).toBe("diag_001")
    })
  })

  test("ignores non-diag files", async () => {
    await runWithDirectory(undefined, async () => {
      // Write a non-diag file
      await ResearchFS.writeYaml(
        ResearchFS.resolve("diagnoses", "other_report.yaml"),
        { id: "other" }
      )
      // Write a diag file
      await ResearchFS.writeYaml(
        ResearchFS.resolve("diagnoses", "diag_002.yaml"),
        { id: "diag_002" }
      )
      const reports = await loadDiagnosisReports()
      // Should only include the diag_ prefixed file
      expect(reports.every((r) => r.id.startsWith("diag_"))).toBe(true)
    })
  })

  test("skips corrupt YAML files gracefully", async () => {
    await runWithDirectory(undefined, async () => {
      // Clean diagnoses dir from previous tests
      const diagDir = ResearchFS.resolve("diagnoses")
      await fs.rm(diagDir, { recursive: true, force: true })
      await fs.mkdir(diagDir, { recursive: true })
      // Write a valid diag file
      await ResearchFS.writeYaml(
        ResearchFS.resolve("diagnoses", "diag_001.yaml"),
        { id: "diag_001" }
      )
      // Write a corrupt YAML file with diag_ prefix
      const corruptPath = ResearchFS.resolve("diagnoses", "diag_bad.yaml")
      await fs.mkdir(path.dirname(corruptPath), { recursive: true })
      await Bun.write(corruptPath, "invalid: [yaml: {broken")
      // loadDiagnosisReports should return only the valid file, skipping the corrupt one
      const reports = await loadDiagnosisReports()
      expect(reports).toHaveLength(1)
      expect(reports[0].id).toBe("diag_001")
    })
  })
})
