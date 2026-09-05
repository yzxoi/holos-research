import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "@ericsanchezok/synergy-plugin/tool";
import { initContext, runWithDirectory } from "../src/ctx";
import type { StateYaml } from "../src/schema";
import { qzcliRun } from "../src/tools/qzcli";
import { seedProject, stubAccessor, stubAuth, stubCache, stubCtx } from "./helpers";

// ── Fixtures ────────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-qzcli-${Date.now()}`);
const FAKE_BIN = path.join(TMP, "fake-qzcli.sh");
const ORIG_QZCLI_BIN = process.env.QZCLI_BIN;

/** Fake qzcli — deterministic responses per subcommand. Unknown command → exit 9. */
const FAKE_SCRIPT = `#!/usr/bin/env bash
cmd="$1"
shift
case "$cmd" in
  create)
    echo '{"job_id":"job-fake-123","name":"exp_007","status":"submitted"}'
    ;;
  status)
    echo '{"job_id":"job-fake-123","status":"running","name":"exp_007"}'
    ;;
  hpc)
    echo '{"job_id":"job-hpc-456","status":"submitted"}'
    ;;
  avail)
    echo "ok"
    ;;
  list)
    echo "job-fake-123 running"
    ;;
  stop)
    echo "Authentication failed: cookie expired" >&2
    exit 1
    ;;
  *)
    echo "unexpected command: $cmd" >&2
    exit 9
    ;;
esac
`;

async function seedPhaseProject(phase?: string) {
  initContext({
    directory: TMP,
    config: stubAccessor() as never,
    auth: stubAuth() as never,
    cache: stubCache() as never,
  });
  const stateOverrides: Record<string, unknown> = {
    project: "qzcli-test",
    config: {
      participation_mode: "collaborative",
      stalled_days: 7,
      exploration: {
        depth: "standard",
        pilot: "enabled",
        max_refine_rounds: 3,
        idea_select_score: 8,
        idea_generators: 3,
      },
      ground: { max_review_rounds: 2, max_closest_works: 3 },
      design: { max_review_rounds: 5, score_threshold: 7, max_primary_claims: 2, max_new_components: 2 },
      experiment: {
        max_optimize_rounds: 3,
        monitor_interval: "30m",
        significance_level: 0.05,
        min_seeds: 3,
        regression_tolerance: 0.05,
      },
      realize: {
        max_review_rounds: 3,
        code_review_threshold: 7,
        require_sanity_contract: true,
        require_quality_contract: true,
      },
      compose: { max_revise_rounds: 3 },
    },
  };
  if (phase) {
    stateOverrides.focus = {
      phase: phase,
      since: new Date().toISOString(),
      refs: {},
      active_phase_run: `pr_${phase}_001`,
    };
  }
  await seedProject(TMP, { state: stateOverrides });
}

async function callQzcli(params: Record<string, any>): Promise<ToolResult> {
  return qzcliRun.execute(params as never, stubCtx) as Promise<ToolResult>;
}

beforeAll(async () => {
  await fs.mkdir(TMP, { recursive: true });
  await fs.writeFile(FAKE_BIN, FAKE_SCRIPT, "utf-8");
  await fs.chmod(FAKE_BIN, 0o755);
  await seedPhaseProject();
});

afterAll(async () => {
  if (ORIG_QZCLI_BIN === undefined) delete process.env.QZCLI_BIN;
  else process.env.QZCLI_BIN = ORIG_QZCLI_BIN;
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("qzcli_run binary detection", () => {
  test("returns clean missing_dependency when QZCLI_BIN points to a nonexistent path", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = "/nonexistent/qzcli";
      const result = await callQzcli({ action: "avail" });
      expect(result.title).toContain("qzcli not installed");
      expect(result.metadata).toMatchObject({ error: "missing_dependency", dependency: "qzcli" });
    });
  });

  test("missing job_id is rejected before spawning", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "status" });
      expect(result.metadata).toMatchObject({ error: "missing_job_id" });
    });
  });
});

describe("qzcli_run phase gate", () => {
  for (const phase of ["realize", "design", "explore", "compose"]) {
    test(`blocks qzcli_run in ${phase} phase`, async () => {
      await runWithDirectory(TMP, async () => {
        await seedPhaseProject(phase);
        process.env.QZCLI_BIN = FAKE_BIN;
        const result = await callQzcli({ action: "create", name: "j", command: "echo hi" });
        expect(result.title).toContain("Phase boundary violation");
        expect(result.metadata).toMatchObject({ error: "phase_boundary_violation", current_phase: phase });
      });
    });
  }

  test("allows qzcli_run in experiment phase", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "avail" });
      expect(result.title).not.toContain("Phase boundary violation");
      expect(result.title).toContain("qzcli avail succeeded");
    });
  });

  test("allows qzcli_run when no phase is set", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject();
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "avail" });
      expect(result.title).not.toContain("Phase boundary violation");
    });
  });
});

describe("qzcli_run action mapping + JSON handling", () => {
  test("create extracts job_id from JSON output and links experiment", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({
        action: "create",
        name: "exp_007",
        command: "python train.py",
        workspace: "ws-1",
        compute_group: "4090",
        experiment_id: "exp_007",
      });
      expect(result.title).toBe("Qizhi job submitted: job-fake-123");
      expect(result.metadata).toMatchObject({
        action: "create",
        job_id: "job-fake-123",
        experiment_id: "exp_007",
        linkage_action: "schedule",
        linkage_target: "job-fake-123",
      });
      expect(String(result.output)).toContain("Experiment Linkage");
      expect(String(result.output)).toContain(
        'research_experiment(action="schedule", id="exp_007", job_id="job-fake-123")',
      );
    });
  });

  test("status returns JSON output with job_id in metadata", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "status", job_id: "job-fake-123" });
      expect(result.title).toBe("qzcli status succeeded");
      expect(result.metadata).toMatchObject({ action: "status", job_id: "job-fake-123" });
    });
  });

  test("hpc extracts job id and marks submit", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({
        action: "hpc",
        name: "cpu-job",
        workspace: "ws-1",
        compute_group: "lcg-1",
        predef_quota_id: "quota-1",
        cpu: 8,
        memory_gb: 32,
        image: "img",
        entrypoint: "bash run.sh",
      });
      expect(result.title).toBe("Qizhi HPC job submitted: job-hpc-456");
      expect(result.metadata).toMatchObject({ job_id: "job-hpc-456" });
    });
  });
});

describe("qzcli_run error handling", () => {
  test("categorizes auth failures from stderr", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "stop", job_id: "job-1" });
      expect(result.title).toContain("qzcli stop failed");
      expect(result.metadata).toMatchObject({ error_category: "AUTH_ERROR" });
      expect(String(result.output)).toContain("Authentication failed");
    });
  });
});

describe("qzcli_run parameter validation", () => {
  test("create requires name and command", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "create", name: "only-name" });
      expect(result.metadata).toMatchObject({ error: "missing_param" });
    });
  });

  test("batch requires config path", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "batch" });
      expect(result.metadata).toMatchObject({ error: "missing_param" });
      expect(String(result.output)).toContain("config");
    });
  });

  test("hpc requires all quota/cpu/image params", async () => {
    await runWithDirectory(TMP, async () => {
      await seedPhaseProject("experiment");
      process.env.QZCLI_BIN = FAKE_BIN;
      const result = await callQzcli({ action: "hpc", name: "j", workspace: "w" });
      expect(result.metadata).toMatchObject({ error: "missing_param" });
      const missing = (result.metadata as any).missing as string[];
      expect(missing).toContain("predef_quota_id");
      expect(missing).toContain("entrypoint");
    });
  });
});
