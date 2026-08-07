import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { generateAndSaveBrief, readBrief } from "../checkpoint-context";
import { ResearchFS } from "../fs";
import { PhaseRunManager } from "../phase-run";
import { mdMeta, notInitialized, withGuard } from "./shared";

const DESCRIPTION = `Generate or read a human checkpoint brief — a detailed context document for human decision-making.

When the research system hits a human checkpoint, the human may not have been watching the process. This tool creates a comprehensive brief summarizing what happened since the last checkpoint, the current state, and what decision is needed.

## Actions

- **action="generate"**: Generate a new checkpoint brief. Requires run_id and optionally checkpoint_kind (defaults to the first pending checkpoint). The brief is saved to .research/checkpoint_briefs/ and the brief_ref is stored on the checkpoint.

- **action="read"**: Read an existing brief by its file path. Returns the full markdown content.

- **action="regenerate"**: Regenerate a brief for a checkpoint that already has one (useful if context has changed since the brief was first generated).

## When to use

- **Automatic**: When a checkpoint is created (addCheckpoint), the system should auto-generate a brief.
- **On demand**: When a human asks for more context about a pending checkpoint.
- **Refresh**: When significant time has passed since the brief was generated and context may have changed.

## Brief contents

The brief includes:
1. **Decision Required** — What the checkpoint is asking
2. **What Happened** — Timeline events, journal notes, human decisions since last checkpoint
3. **Current State** — Inner loop progress, entity overview
4. **Key Entities** — Ideas, plans, experiments, claims in focus
5. **Story & RQG** — StorySpine, result quality gate, diagnosis
6. **Considerations** — Context-specific options and trade-offs

Files: .research/checkpoint_briefs/*.md`;

export const checkpointBrief = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["generate", "read", "regenerate"])
      .describe("Generate a new brief, read an existing one, or regenerate an existing brief"),
    run_id: z.string().optional().describe("Phase run ID (required for generate/regenerate)"),
    checkpoint_kind: z
      .string()
      .optional()
      .describe("Checkpoint kind to generate brief for. Defaults to the first pending checkpoint in the run."),
    brief_path: z
      .string()
      .optional()
      .describe("Path to the brief file (required for read action, or for regenerate to specify which checkpoint)"),
  },
  async execute(params) {
    return withGuard(async () => {
      if (!(await ResearchFS.isInitialized())) {
        return {
          title: "Not initialized",
          output: "No research project found. Run research_init first.",
          metadata: mdMeta({ error: "not_initialized" }),
        };
      }
      if (params.action === "read") {
        if (!params.brief_path) {
          return {
            title: "Missing brief_path",
            output: "read action requires brief_path — the path to the brief markdown file.",
            metadata: mdMeta({ error: "missing_brief_path" }),
          };
        }

        const content = await readBrief(params.brief_path);
        if (!content) {
          return {
            title: "Brief not found",
            output: `Brief file not found: ${params.brief_path}`,
            metadata: mdMeta({ error: "not_found" }),
          };
        }

        return {
          title: "Checkpoint Brief",
          output: content,
          metadata: mdMeta({ brief_path: params.brief_path }),
        };
      }

      // generate or regenerate
      if (!params.run_id) {
        return {
          title: "Missing run_id",
          output: "generate/regenerate requires run_id — the phase run ID.",
          metadata: mdMeta({ error: "missing_run_id" }),
        };
      }

      const run = await PhaseRunManager.read(params.run_id);
      if (!run) {
        return {
          title: "Phase run not found",
          output: `Phase run not found: ${params.run_id}`,
          metadata: mdMeta({ error: "not_found" }),
        };
      }

      // Determine checkpoint kind
      let checkpointKind = params.checkpoint_kind;
      let checkpointQuestion: string | undefined;

      if (!checkpointKind) {
        const pending = run.human_checkpoints.filter((cp) => cp.status === "pending");
        if (pending.length === 0) {
          return {
            title: "No pending checkpoints",
            output: `No pending checkpoints found in run ${params.run_id}. Specify checkpoint_kind explicitly if needed.`,
            metadata: mdMeta({ error: "no_pending" }),
          };
        }
        checkpointKind = pending[0]!.kind;
        checkpointQuestion = pending[0]!.question;
      } else {
        const cp = run.human_checkpoints.find((cp) => cp.kind === checkpointKind && cp.status === "pending");
        checkpointQuestion = cp?.question;
      }

      if (!checkpointQuestion) {
        checkpointQuestion = `Please review and decide on the ${checkpointKind} checkpoint.`;
      }

      // Generate the brief
      const brief = await generateAndSaveBrief({
        phaseRunId: params.run_id,
        checkpointKind,
        checkpointQuestion,
      });

      if (!brief) {
        return notInitialized();
      }

      // Update the checkpoint with brief_ref
      const updatedCheckpoints = run.human_checkpoints.map((cp) =>
        cp.kind === checkpointKind && cp.status === "pending"
          ? {
              ...cp,
              brief_ref: brief.filePath,
              brief_generated_at: brief.generatedAt,
            }
          : cp,
      );

      await PhaseRunManager.update(params.run_id, {
        human_checkpoints: updatedCheckpoints,
      });

      // Read the brief content for output
      const content = await readBrief(brief.filePath);

      return {
        title: `Checkpoint Brief: ${checkpointKind}`,
        output: [
          `✅ Brief generated and saved to ${brief.filePath}`,
          "",
          content ?? "(brief content unavailable)",
        ].join("\n"),
        metadata: mdMeta({
          brief_id: brief.id,
          brief_path: brief.filePath,
          generated_at: brief.generatedAt,
          checkpoint_kind: checkpointKind,
          run_id: params.run_id,
        }),
      };
    });
  },
});
