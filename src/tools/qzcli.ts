import { existsSync } from "node:fs";
import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { updateActivePhaseRun } from "../phase-run";
import type { StateYaml } from "../schema";
import { mdMeta, notInitialized, withGuard } from "./shared";

/**
 * qzcli_run — 启智（Qizhi）平台 CLI 桥接工具。
 *
 * qzcli（https://github.com/tianyilt/qzcli_tool，pip 包名 `qzcli`）是启智平台的
 * kubectl/docker 风格 CLI：资源发现、节点查询、任务提交/管理、日志、批量/HPC。
 * 本工具把它包装成 research 插件的一个工具，提供：
 *   - 懒检测：qzcli 未安装时给出 pip install 指引（与 compute_submit 对
 *     compute-submit-kit 的处理一致）；
 *   - 阶段门禁：与 compute_submit 一致，仅 experiment 阶段可用；
 *   - action 映射：把结构化参数映射为 qzcli 子命令，支持 --json 输出；
 *   - 透传：extra_args 可携带 qzcli 专有 flag（--exclude-node / --dataset /
 *     --password-stdin 等），避免镜像全部参数面；
 *   - experiment 联动：create/hpc 成功后打印 research_experiment(schedule)
 *     指引，experiment_id 传入时在 metadata 中给出 linkage。
 *
 * 凭据：不接收密码参数。qzcli 从 ~/.qzcli/.env、config.json 或环境变量
 * （QZCLI_USERNAME / QZCLI_PASSWORD / QZCLI_API_URL）读取，见
 * `qzcli login --help`。login 动作仅支持 username（经 QZCLI_USERNAME 传递），
 * 密码请预置于 ~/.qzcli/.env（chmod 600）。
 */

const ACTIONS = ["login", "res", "avail", "create", "list", "status", "stop", "logs", "batch", "hpc"] as const;

/** 子命令支持 --json 输出（追加 --json 并尝试结构化解析）。 */
const JSON_ACTIONS = new Set(["create", "status", "logs", "hpc"]);

/** 提交类动作：成功后把 active phase run 标记为 attempt（与 compute_submit 一致）。 */
const SUBMIT_ACTIONS = new Set(["create", "batch", "hpc"]);

/** qzcli create/hpc 的 --json 输出中可能的任务 ID 字段名（防御式探测）。 */
const JOB_ID_KEYS = ["job_id", "jobId", "task_id", "taskId", "id", "instance_id", "instanceId"];

function qzcliBin(): string | null {
  if (process.env.QZCLI_BIN) {
    // Explicit path — verify it actually exists so a stale env var yields a
    // clean "not installed" result instead of a confusing spawn error.
    try {
      return existsSync(process.env.QZCLI_BIN) ? process.env.QZCLI_BIN : null;
    } catch {
      return null;
    }
  }
  try {
    return Bun.which("qzcli") ?? null;
  } catch {
    return null;
  }
}

function extractJobId(text: string): string | null {
  try {
    const data = JSON.parse(text);
    const scan = (obj: unknown, depth: number): string | null => {
      if (depth > 3 || obj === null || typeof obj !== "object") return null;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const hit = scan(item, depth + 1);
          if (hit) return hit;
        }
        return null;
      }
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (JOB_ID_KEYS.includes(key) && typeof value === "string" && value) return value;
      }
      for (const value of Object.values(obj as Record<string, unknown>)) {
        const hit = scan(value, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    return scan(data, 0);
  } catch {
    return null;
  }
}

function buildArgv(action: string, params: Record<string, unknown>): string[] {
  const argv = [action];
  const push = (flag: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") {
      argv.push(flag, String(value));
    }
  };

  switch (action) {
    case "login":
      push("--username", params.username);
      if (params.workspace) push("--workspace", params.workspace);
      // 密码不进入 argv；调用方通过环境变量 QZCLI_PASSWORD 提供（见 exec env）。
      break;
    case "res":
      if (params.workspace) push("--workspace", params.workspace);
      if (params.update) argv.push("--update");
      if (params.full) argv.push("--full");
      if (params.list) argv.push("--list");
      break;
    case "avail":
      if (params.workspace) push("--workspace", params.workspace);
      if (params.compute_group) push("--group", params.compute_group);
      if (typeof params.instances === "number") push("--nodes", params.instances);
      break;
    case "create":
      push("--name", params.name);
      push("--command", params.command);
      push("--workspace", params.workspace);
      push("--project", params.project);
      push("--compute-group", params.compute_group);
      push("--spec", params.spec);
      push("--image", params.image);
      if (typeof params.instances === "number") push("--instances", params.instances);
      if (typeof params.priority === "number") push("--priority", params.priority);
      if (params.no_track) argv.push("--no-track");
      if (params.dry_run) argv.push("--dry-run");
      break;
    case "list":
      if (params.workspace) push("--workspace", params.workspace);
      if (params.filter_status) push("--status", params.filter_status);
      if (params.running) argv.push("--running");
      if (typeof params.limit === "number") push("--limit", params.limit);
      argv.push("--compact");
      break;
    case "status":
    case "stop":
    case "logs":
      argv.push(String(params.job_id ?? ""));
      if (action === "logs" && typeof params.tail === "number") push("--tail", params.tail);
      break;
    case "batch":
      argv.push(String(params.config ?? ""));
      if (params.dry_run) argv.push("--dry-run");
      if (typeof params.delay === "number") push("--delay", params.delay);
      if (params.continue_on_error) argv.push("--continue-on-error");
      break;
    case "hpc":
      push("--name", params.name);
      push("--workspace", params.workspace);
      push("--project", params.project);
      push("--compute-group", params.compute_group);
      if (params.predef_quota_id) push("--predef-quota-id", params.predef_quota_id);
      if (typeof params.cpu === "number") push("--cpu", params.cpu);
      if (typeof params.memory_gb === "number") push("--mem-gi", params.memory_gb);
      push("--image", params.image);
      push("--entrypoint", params.entrypoint);
      if (typeof params.instances === "number") push("--instances", params.instances);
      if (typeof params.priority === "number") push("--priority", params.priority);
      if (params.no_track) argv.push("--no-track");
      if (params.dry_run) argv.push("--dry-run");
      break;
  }

  if (JSON_ACTIONS.has(action) && params.json !== false) argv.push("--json");
  for (const extra of (params.extra_args as string[] | undefined) ?? []) argv.push(extra);
  return argv;
}

const DESCRIPTION = `Run the Qizhi (启智) platform CLI \`qzcli\` from inside a research project.

qzcli is a kubectl/docker-style CLI for managing GPU compute jobs on the Qizhi
platform (https://github.com/tianyilt/qzcli_tool). This tool wraps it with
structured parameters, research-phase gating, and experiment linkage.

Actions:
- **login** — CAS login (username only; password via ~/.qzcli/.env or QZCLI_PASSWORD env)
- **res** — refresh/list cached workspaces + compute groups (\`--update\` after joining new workspaces)
- **avail** — query free nodes per compute group
- **create** — submit a GPU training job
- **list** — list jobs (compact table)
- **status** — job status/detail (JSON)
- **stop** — stop a job
- **logs** — fetch job logs (JSON, \`--tail\` for recent lines)
- **batch** — batch submit from a JSON config file
- **hpc** — submit HPC/CPU (Slurm-style) jobs

Setup (one-time):
1. Install: \`git clone https://github.com/tianyilt/qzcli_tool && cd qzcli_tool && pip install -r requirements.txt && pip install -e .\`
2. Credentials: \`mkdir -p ~/.qzcli && chmod 600 ~/.qzcli/.env\` with QZCLI_USERNAME/QZCLI_PASSWORD, or run \`qzcli login\` interactively.
3. Discover: \`qzcli_run(action="res", update=true)\` then \`qzcli_run(action="avail")\`.

Only available in the **experiment** phase (same gate as compute_submit).
\`extra_args\` passes through qzcli-specific flags (e.g. \`--exclude-node\`,
\`--dataset\`, \`--include-node\`).`;

export const qzcliRun = tool({
  description: DESCRIPTION,
  args: {
    action: z.enum(ACTIONS).describe("qzcli subcommand to run"),
    workspace: z.string().optional().describe("Workspace name or ID (ws-...)"),
    project: z.string().optional().describe("Project name or ID (create/hpc)"),
    compute_group: z.string().optional().describe("Compute group name or ID (lcg-...)"),
    name: z.string().optional().describe("Job name (create/hpc)"),
    command: z.string().optional().describe("Command to run (create)"),
    image: z.string().optional().describe("Docker image (create/hpc)"),
    entrypoint: z.string().optional().describe("Entry command (hpc)"),
    spec: z.string().optional().describe("Resource spec ID (create)"),
    predef_quota_id: z.string().optional().describe("HPC predefined quota ID (hpc)"),
    cpu: z.number().optional().describe("CPUs per node (hpc)"),
    memory_gb: z.number().optional().describe("Memory GiB per node (hpc)"),
    instances: z.number().optional().describe("Node count (avail: required free nodes; create/hpc)"),
    priority: z.number().optional().describe("Priority 1-10 (create: higher = more urgent; hpc: higher = more urgent)"),
    job_id: z.string().optional().describe("Job ID (status/stop/logs)"),
    tail: z.number().optional().describe("Recent N log lines (logs, default 200)"),
    limit: z.number().optional().describe("Max rows (list, default 20)"),
    filter_status: z.string().optional().describe("Filter jobs by status (list)"),
    running: z.boolean().optional().describe("Only running/queued jobs (list)"),
    config: z.string().optional().describe("Path to batch config JSON (batch)"),
    delay: z.number().optional().describe("Seconds between batch submissions (batch, default 3)"),
    continue_on_error: z.boolean().optional().describe("Continue batch on error (batch)"),
    username: z.string().optional().describe("Qizhi username (login; sent via QZCLI_USERNAME env)"),
    update: z.boolean().optional().describe("Force refresh workspace cache (res)"),
    full: z.boolean().optional().describe("Full spec scan (res, slow)"),
    list: z.boolean().optional().describe("List cached workspaces (res)"),
    dry_run: z.boolean().optional().describe("Preview only, do not submit"),
    no_track: z.boolean().optional().describe("Do not auto-track job (create/hpc)"),
    json: z.boolean().optional().describe("Request --json output where supported (default true)"),
    experiment_id: z.string().optional().describe("Link to research_experiment record (create/hpc)"),
    extra_args: z
      .array(z.string())
      .optional()
      .describe("Pass-through qzcli flags (e.g. --exclude-node qb-gpu1 --dataset id:v1)"),
  },
  async execute(params, ctx) {
    return withGuard(async () => {
      if (!(await ResearchFS.isInitialized())) {
        return notInitialized();
      }
      const { action } = params;

      // Phase gate: qzcli_run is ONLY allowed in the experiment phase —
      // same discipline as compute_submit (see src/tools/compute.ts).
      const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
      const currentPhase = state?.focus?.phase;
      const activePhaseRun = state?.focus?.active_phase_run;
      if (currentPhase && currentPhase !== "experiment") {
        return {
          title: "❌ Phase boundary violation",
          output: `qzcli_run is only available in the experiment phase. Current phase: ${currentPhase}.\n\nTo run Qizhi jobs, advance first:\n\`\`\`\nresearch_state(action="advance", target_phase="experiment")\n\`\`\`\n\nRealize phase is for writing code and verifying sanity contracts only (<5 min, single GPU). If you need to submit a job, the code is ready — advance to experiment phase.`,
          metadata: mdMeta({ error: "phase_boundary_violation", current_phase: currentPhase }),
        };
      }

      // Lazy detection of the qzcli binary.
      const bin = qzcliBin();
      if (!bin) {
        return {
          title: "qzcli not installed",
          output: [
            "qzcli CLI was not found on PATH (and QZCLI_BIN is not set).",
            "",
            "Install it (one-time, requires Python 3.8+):",
            "```bash",
            "git clone https://github.com/tianyilt/qzcli_tool",
            "cd qzcli_tool && pip install -r requirements.txt && pip install -e .",
            "```",
            "",
            "Credentials (do NOT pass passwords to this tool):",
            "```bash",
            "mkdir -p ~/.qzcli && chmod 600 ~/.qzcli/.env",
            "# QZCLI_USERNAME=...  QZCLI_PASSWORD=...  (or run `qzcli login` interactively)",
            "```",
            "",
            "Alternatively set QZCLI_BIN to the absolute path of the qzcli executable.",
          ].join("\n"),
          metadata: mdMeta({ error: "missing_dependency", dependency: "qzcli" }),
        };
      }

      if (action === "status" || action === "stop" || action === "logs") {
        if (!params.job_id) {
          return {
            title: `Missing job_id`,
            output: `${action} requires job_id (e.g. job-xxxx). Get it from qzcli_run(action="list") or the create result.`,
            metadata: mdMeta({ error: "missing_job_id" }),
          };
        }
      }
      if (action === "batch") {
        if (!params.config) {
          return {
            title: "Missing batch config",
            output:
              'batch requires config (path to a qzcli batch JSON file). See qzcli batch --help for the schema: {"defaults": {...}, "matrix": {...}, "name_template": "...", "command_template": "..."}.',
            metadata: mdMeta({ error: "missing_param" }),
          };
        }
      }
      if (action === "create") {
        if (!params.name || !params.command) {
          return {
            title: "Missing create params",
            output:
              'create requires both name and command (e.g. action="create", name="exp_007", command="python train.py"). Workspace/compute-group/image resolve from qzcli res cache or are auto-selected.',
            metadata: mdMeta({ error: "missing_param" }),
          };
        }
      }
      if (action === "hpc") {
        const required = {
          name: params.name,
          workspace: params.workspace,
          compute_group: params.compute_group,
          predef_quota_id: params.predef_quota_id,
          cpu: params.cpu,
          memory_gb: params.memory_gb,
          image: params.image,
          entrypoint: params.entrypoint,
        };
        const missing = Object.entries(required)
          .filter(([, v]) => v === undefined || v === null || v === "")
          .map(([k]) => k);
        if (missing.length > 0) {
          return {
            title: "Missing hpc params",
            output: `hpc requires: ${missing.join(", ")} (see qzcli hpc --help).`,
            metadata: mdMeta({ error: "missing_param", missing }),
          };
        }
      }

      const argv = buildArgv(action, params as Record<string, unknown>);
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...(params.username ? { QZCLI_USERNAME: String(params.username) } : {}),
      };
      // Prevent qzcli from trying interactive prompts when we can't answer.
      env.NONINTERACTIVE = "1";

      let proc: ReturnType<typeof Bun.spawnSync>;
      try {
        proc = Bun.spawnSync([bin, ...argv], {
          env,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 180_000,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          title: `qzcli failed to start`,
          output: `Failed to spawn qzcli: ${message}`,
          metadata: mdMeta({ error: "spawn_error", action }),
        };
      }

      const stdout = proc.stdout?.toString() ?? "";
      const stderr = proc.stderr?.toString() ?? "";
      const exitCode = proc.exitCode ?? -1;

      if (exitCode !== 0) {
        const message = (stderr || stdout || "unknown error").trim();
        let category = "UNKNOWN_ERROR";
        let actionable = message;
        if (/auth|credential|token|unauthorized|forbidden|cookie/i.test(message)) {
          category = "AUTH_ERROR";
          actionable = `Qizhi authentication failed: ${message}\n\nSuggestions:\n- Check ~/.qzcli/.env credentials or re-run \`qzcli login\`\n- Run \`qzcli_run(action="res", update=true)\` to refresh caches`;
        } else if (/network|timeout|econnrefused|ENOTFOUND|ECONNRESET/i.test(message)) {
          category = "NETWORK_ERROR";
          actionable = `Network error: ${message}\n\nSuggestions:\n- Check your internet connection\n- Verify the platform endpoint is reachable\n- Retry after a few moments`;
        } else if (/未找到|not found|不存在/i.test(message)) {
          category = "NOT_FOUND";
          actionable = `Not found: ${message}\n\nSuggestions:\n- Verify workspace / compute group names or IDs exist\n- Run \`qzcli_run(action="res", update=true)\` to refresh the cache`;
        }
        return {
          title: `qzcli ${action} failed (exit ${exitCode})`,
          output: actionable,
          metadata: mdMeta({ error: message.slice(0, 500), error_category: category, exit_code: exitCode, action }),
        };
      }

      // Success.
      const jsonMode = JSON_ACTIONS.has(action) && params.json !== false;
      const output = stdout.trim() || "(no output)";
      let jobId: string | null = null;
      if (jsonMode) {
        jobId = extractJobId(stdout);
        // Keep raw JSON for agent parsing; attach job id in metadata too.
      } else if (action === "list") {
        // Table output — keep as-is.
      }

      const lines: string[] = [];
      if (SUBMIT_ACTIONS.has(action) && !params.dry_run) {
        const currentPhaseNow = state?.focus?.phase ?? "experiment";
        await updateActivePhaseRun(
          currentPhaseNow,
          { state: "attempt", summary: `Qizhi job submitted via qzcli (${action})` },
          activePhaseRun,
        ).catch(() => {});
        if (params.experiment_id) {
          lines.push(
            "=== Experiment Linkage ===",
            `To link this job to experiment "${params.experiment_id}", run:`,
            `  research_experiment(action="schedule", id="${params.experiment_id}", job_id="${jobId ?? "<job-id>"}")`,
          );
        }
      }

      const metadata: Record<string, unknown> = { action, exit_code: exitCode, json_mode: jsonMode };
      if (jobId) metadata.job_id = jobId;
      if (SUBMIT_ACTIONS.has(action) && params.experiment_id) {
        metadata.experiment_id = params.experiment_id;
        metadata.linkage_action = "schedule";
        metadata.linkage_target = jobId ?? null;
      }
      if (params.dry_run) metadata.dry_run = true;

      const title =
        action === "create" && jobId
          ? `Qizhi job submitted: ${jobId}`
          : action === "hpc" && jobId
            ? `Qizhi HPC job submitted: ${jobId}`
            : `qzcli ${action} succeeded`;

      return {
        title,
        output: [...lines, output].join("\n").trim(),
        metadata: mdMeta(metadata),
      };
    });
  },
});
