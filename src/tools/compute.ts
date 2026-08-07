import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { updateActivePhaseRun } from "../phase-run";
import type { StateYaml } from "../schema";
import { mdMeta, missingParam, notInitialized, withGuard } from "./shared";

// Lazy imports — compute-submit-kit may not be installed in all environments
interface ComputeSubmitter {
  submit: (...args: any[]) => Promise<any>;
}

let InteractiveSubmitter: (new (...args: any[]) => ComputeSubmitter) | null = null;
let DistributedSubmitter: (new (...args: any[]) => ComputeSubmitter) | null = null;
let hasInternetAccess: ((workspace: string) => boolean) | null = null;
let SubmitError: (new (...args: any[]) => Error & { code: string }) | null = null;
let kitLoaded = false;
let kitError: string | null = null;

async function loadComputeKit(): Promise<void> {
  if (kitLoaded) return;
  try {
    // @ts-expect-error compute-submit-kit not available in CI
    const interactive = await import("compute-submit-kit/submit/interactive");
    // @ts-expect-error compute-submit-kit not available in CI
    const distributed = await import("compute-submit-kit/submit/distributed");
    // @ts-expect-error compute-submit-kit not available in CI
    const common = await import("compute-submit-kit/submit/common");
    // @ts-expect-error compute-submit-kit not available in CI
    const types = await import("compute-submit-kit/types");
    InteractiveSubmitter = interactive.InteractiveSubmitter;
    DistributedSubmitter = distributed.DistributedSubmitter;
    hasInternetAccess = common.hasInternetAccess;
    SubmitError = types.SubmitError;
    kitLoaded = true;
  } catch {
    // compute-submit-kit not installed — kitError will inform the user
    kitError = "compute-submit-kit is not installed. Install with: npm install compute-submit-kit";
    kitLoaded = true;
  }
}

function isSubmitError(err: unknown): err is Error & { code: string } {
  if (SubmitError && err instanceof SubmitError) return true;
  return err instanceof Error && err.name === "SubmitError" && "code" in err;
}

const DESCRIPTION = `Unified compute submission for the SII Inspire platform.

Provides two modes:
- **interactive**: Create notebook instance + setup rtunnel SSH tunnel for development/debugging
- **distributed**: Submit multi-GPU distributed training tasks

Interactive mode flow:
1. Creates notebook via inspire_notebook
2. Waits for notebook to be running
3. Sets up rtunnel server + sshd inside container
4. Starts local rtunnel client
5. Returns SSH connection command

Distributed mode flow:
1. Validates command for offline workspace constraints
2. Submits task via inspire_submit
3. Returns job info with monitoring links

Both modes automatically link to research_experiment lifecycle when experiment_id is provided.`;

export const computeSubmit = tool({
  description: DESCRIPTION,
  args: {
    mode: z.enum(["interactive", "distributed"]).describe("Submission mode"),
    name: z.string().describe("Notebook or task name"),
    workspace: z.string().describe("Workspace name or ID"),
    compute_group: z.string().describe("Compute group name or ID (e.g. '4090', 'H100', 'H200')"),
    image: z.string().describe("Docker image (platform display domain)"),
    command: z.string().optional().describe("Training command (distributed mode)"),
    ssh_public_key: z.string().optional().describe("SSH public key (interactive mode)"),
    ssh_private_key_path: z
      .string()
      .optional()
      .default("~/.ssh/id_ed25519")
      .describe("Path to SSH private key for connection (interactive mode)"),
    gpu_type: z
      .enum(["H100", "H200", "A100", "A100-80G", "RTX-4090", "RTX-3090", "V100", "T4", "OTHER"])
      .optional()
      .describe("GPU type selection. Must match the compute_group GPU availability."),
    gpu_count: z.number().optional().describe("Number of GPUs per node (default: 1)"),
    cpu_count: z.number().optional().describe("Number of CPUs per node"),
    memory_gb: z.number().optional().describe("Memory in GB per node"),
    nodes: z.number().optional().describe("Number of nodes (distributed, default 1)"),
    shm: z.number().optional().describe("Shared memory in MB (distributed, default 1200)"),
    priority: z.number().optional().describe("Task priority"),
    experiment_id: z.string().optional().describe("Link to research_experiment record"),
  },
  async execute(params) {
    return withGuard(async () => {
      if (!(await ResearchFS.isInitialized())) {
        return {
          title: "Not initialized",
          output: "No research project found. Run research_init first.",
          metadata: { error: "not_initialized" },
        };
      }
      const { mode, name, workspace, compute_group, image, experiment_id, gpu_type, gpu_count, cpu_count, memory_gb } =
        params;

      // Phase gate: compute_submit is ONLY allowed in experiment phase.
      // audit#2 P0-11 noted ARCHITECTURE.md lists this tool under realize as
      // well; that doc is out of date — the team's intent (encoded in
      // skills/method-realize/content.txt and test/phase-gate.test.ts) is that
      // realize phase MUST NOT submit compute jobs. ARCHITECTURE.md was fixed
      // separately to match.
      const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
      const currentPhase = state?.focus?.phase;
      const activePhaseRun = state?.focus?.active_phase_run;
      if (currentPhase && currentPhase !== "experiment") {
        return {
          title: "❌ Phase boundary violation",
          output: `compute_submit is only available in the experiment phase. Current phase: ${currentPhase}.\n\nTo run experiments, advance first:\n\`\`\`\nresearch_state(action="advance", target_phase="experiment")\n\`\`\`\n\nRealize phase is for writing code and verifying sanity contracts only (<5 min, single GPU). If you need to run training, the code is ready — advance to experiment phase.`,
          metadata: mdMeta({ error: "phase_boundary_violation", current_phase: currentPhase }),
        };
      }

      // Ensure compute-submit-kit is available
      await loadComputeKit();
      if (kitError) {
        return {
          title: "Compute kit unavailable",
          output: kitError,
          metadata: mdMeta({ error: "missing_dependency" }),
        };
      }

      function formatError(err: unknown): { title: string; output: string; metadata: Record<string, unknown> } {
        const message = err instanceof Error ? err.message : String(err);
        let category = "UNKNOWN_ERROR";
        let actionable = message;

        if (isSubmitError(err)) {
          category = err.code;
          switch (err.code) {
            case "AUTH_ERROR":
              actionable = `Authentication failed: ${message}\n\nSuggestions:\n- Check your API token or credentials\n- Ensure your account has access to workspace "${workspace}" and compute group "${compute_group}"`;
              break;
            case "NETWORK_ERROR":
              actionable = `Network error: ${message}\n\nSuggestions:\n- Check your internet connection\n- Verify the platform endpoint is reachable\n- Retry after a few moments`;
              break;
            case "VALIDATION_ERROR":
              actionable = `Validation error: ${message}\n\nSuggestions:\n- Check that all required fields are provided and valid\n- Verify the image name format (expected: docker.sii.shaipower.online/...)`;
              break;
            case "TIMEOUT_ERROR":
              actionable = `Timeout: ${message}\n\nSuggestions:\n- The platform may be experiencing high load; retry later\n- Consider increasing timeout if applicable`;
              break;
            case "NOT_FOUND":
              actionable = `Not found: ${message}\n\nSuggestions:\n- Verify workspace and compute group names/IDs exist\n- Check that the specified image is available`;
              break;
            default:
              actionable = `Error (${err.code}): ${message}`;
          }
        } else if (/auth|credential|token|unauthorized|forbidden/i.test(message)) {
          category = "AUTH_ERROR";
          actionable = `Authentication failed: ${message}\n\nSuggestions:\n- Check your API token or credentials\n- Ensure your account has access to workspace "${workspace}" and compute group "${compute_group}"`;
        } else if (/network|timeout|econnrefused|ENOTFOUND|ECONNRESET/i.test(message)) {
          category = "NETWORK_ERROR";
          actionable = `Network error: ${message}\n\nSuggestions:\n- Check your internet connection\n- Verify the platform endpoint is reachable\n- Retry after a few moments`;
        } else if (/validation|invalid|missing|required/i.test(message)) {
          category = "VALIDATION_ERROR";
          actionable = `Validation error: ${message}\n\nSuggestions:\n- Check that all required fields are provided and valid\n- Verify the image name format (expected: docker.sii.shaipower.online/...)`;
        }

        return {
          title: `${mode === "interactive" ? "Interactive" : "Distributed"} submission failed`,
          output: actionable,
          metadata: mdMeta({ error: message, error_category: category }),
        };
      }

      if (mode === "interactive") {
        if (!params.ssh_public_key) {
          return missingParam("ssh_public_key", "interactive mode requires SSH public key");
        }

        const submitter = new InteractiveSubmitter!({
          workspace,
          computeGroup: compute_group,
          image,
        });

        const online = hasInternetAccess!(workspace);
        const warnings: string[] = [];
        if (!online) {
          warnings.push(
            "⚠️  Warning: This workspace does not have internet access.\n   Network-dependent operations (pip install, git clone, wget, curl) will fail.\n   Pre-install dependencies in your image or use an online workspace.",
          );
        }

        // GPU type vs compute_group heuristic check
        if (gpu_type && compute_group) {
          const groupUpper = compute_group.toUpperCase();
          const gpuUpper = gpu_type.toUpperCase();
          const gpuShort = gpuUpper.replace(/^(RTX-|A100-80G|H100-|H200-)/, "");
          if (!groupUpper.includes(gpuShort) && !gpuShort.includes(groupUpper)) {
            warnings.push(`⚠️ GPU type ${gpu_type} may not match compute group ${compute_group}`);
          }
        }

        try {
          const connection = await submitter.submit({
            name,
            sshPublicKey: params.ssh_public_key,
            gpuCount: gpu_count,
            cpuCount: cpu_count,
            memorySize: memory_gb,
          });

          const sshCommand = `ssh root@localhost -p ${connection.localPort} -i ${params.ssh_private_key_path ?? "~/.ssh/id_ed25519"}`;

          const lines = [
            "=== Interactive Notebook Created ===",
            "",
            `Notebook ID: ${connection.notebookId}`,
            `Name: ${connection.name}`,
            `Status: ${connection.status}`,
            "",
            "=== Resource Configuration ===",
            `GPU Type: ${gpu_type ?? "default"}`,
            `GPU Count: ${gpu_count ?? 1}`,
            `Compute Group: ${compute_group}`,
            "",
            "=== SSH Connection (rtunnel) ===",
            `Proxy URL: ${connection.proxyUrl}`,
            `Local Port: ${connection.localPort}`,
            `Remote Port: ${connection.remotePort}`,
            "",
            "1. Local rtunnel is already started.",
            "2. Connect via SSH:",
            `   ${sshCommand}`,
            "",
            "=== Reverse Proxy (for internet access) ===",
            "If you need internet access in the container:",
            `   ssh -NR 7890:127.0.0.1:7890 -p ${connection.localPort} root@localhost`,
            "",
            `Notebook Page: ${connection.notebookUrl}`,
          ];

          if (warnings.length > 0) {
            lines.push("", ...warnings);
          }

          if (experiment_id) {
            lines.push(
              "",
              "=== Experiment Linkage ===",
              `To link this notebook to experiment "${experiment_id}", run:`,
              `  research_experiment(action="schedule", id="${experiment_id}", notebook_id="${connection.notebookId}")`,
            );
          }

          const currentPhase = state?.focus?.phase ?? "experiment";
          await updateActivePhaseRun(
            currentPhase,
            {
              state: "attempt",
              summary: `Compute provisioned: ${gpu_type ?? "GPU"}`,
            },
            activePhaseRun,
          );

          return {
            title: `Interactive: ${name}`,
            output: lines.join("\n"),
            metadata: mdMeta({
              notebook_id: connection.notebookId,
              proxy_url: connection.proxyUrl,
              local_port: connection.localPort,
              ssh_command: sshCommand,
              ...(experiment_id
                ? { experiment_id, linkage_action: "schedule", linkage_target: connection.notebookId }
                : {}),
            }),
          };
        } catch (err) {
          return formatError(err);
        }
      }

      // Distributed mode
      if (!params.command) {
        return missingParam("command", "distributed mode requires training command");
      }

      const submitter = new DistributedSubmitter!({
        workspace,
        computeGroup: compute_group,
        image,
      });

      try {
        const job = await submitter.submit({
          name,
          command: params.command,
          nodes: params.nodes,
          shm: params.shm,
          priority: params.priority,
        });

        const lines = [
          "=== Training Task Submitted ===",
          "",
          `Job ID: ${job.jobId}`,
          `Name: ${job.name}`,
          `Status: ${job.status}`,
          `Workspace: ${job.workspace}`,
          `Compute Group: ${job.computeGroup}`,
          "",
          "=== Resource Configuration ===",
          `GPU Type: ${gpu_type ?? "default"}`,
          `GPUs per Node: ${gpu_count ?? "default"}`,
          `Nodes: ${job.nodes}`,
          "",
          `Job Page: ${job.jobUrl}`,
          `Storage: ${job.storagePath}`,
          "",
          "Monitor with:",
          `  inspire_jobs(workspace="${workspace}")`,
          `  inspire_logs(job_id="${job.jobId}")`,
        ];

        if (experiment_id) {
          lines.push(
            "",
            "=== Experiment Linkage ===",
            `To link this job to experiment "${experiment_id}", run:`,
            `  research_experiment(action="schedule", id="${experiment_id}", job_id="${job.jobId}")`,
          );
        }

        const currentPhase = state?.focus?.phase ?? "experiment";
        await updateActivePhaseRun(
          currentPhase,
          {
            state: "attempt",
            summary: `Compute provisioned: ${gpu_type ?? "GPU"}`,
          },
          activePhaseRun,
        );

        return {
          title: `Distributed: ${name}`,
          output: lines.join("\n"),
          metadata: mdMeta({
            job_id: job.jobId,
            job_url: job.jobUrl,
            storage_path: job.storagePath,
            ...(experiment_id ? { experiment_id, linkage_action: "schedule", linkage_target: job.jobId } : {}),
          }),
        };
      } catch (err) {
        return formatError(err);
      }
    });
  },
});
