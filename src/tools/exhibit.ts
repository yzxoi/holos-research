import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { ResearchId } from "../id";
import { ResearchJournal } from "../journal";
import { withLock } from "../lock";
import { log } from "../log";
import { updateActivePhaseRun } from "../phase-run";
import { ResearchReview } from "../review";
import type { ExhibitYaml, StateYaml } from "../schema";
import { ExhibitKind, ExhibitStatus, ReviewVerdict } from "../schema";
import { ResearchTimeline } from "../timeline";
import {
  appendNotes,
  entityMdPath,
  exhibitMutex,
  isTerminalTransition,
  mdMeta,
  missingParam,
  notFound,
  notInitialized,
  withGuard,
} from "./shared";

const DESCRIPTION = `Manage exhibits — figures, tables, and supplementary material as first-class evidence objects.

An exhibit is an evidence carrier (figure, table, extended data, appendix) that tracks its provenance to experiments and claims, its lifecycle through production stages, and its review history. Exhibits bridge raw experimental results and the final paper — every figure or table in the manuscript should have a corresponding exhibit record with full traceability.

## Actions

- **create**: Register a new exhibit. Assigns an auto-incrementing ID (e.g. exh_003), creates a .yaml (metadata) and a .md template (description, generation notes, draft caption). Specify kind (figure, table, supplementary_figure, supplementary_table, extended_data, appendix) and optionally link to source experiments, claims, generation script, or data path.

- **bind_sources**: Link an exhibit to its evidence sources after creation. Merges new experiments, claims, script, or data_path into the existing sources object. Does not change exhibit status — use this as provenance is discovered or refined.

- **render**: Mark an exhibit as rendered/generated. The generation script has been run and the output file exists. Optionally record the output_path. Transitions status to "rendered".

- **verify**: Mark an exhibit as verified — data accuracy, axis labels, legend, and visual quality have been checked. Transitions status to "verified".

- **approve**: Approve an exhibit for inclusion in the paper. Transitions status to "approved".

- **supersede**: Replace this exhibit with a newer version. Transitions status to "superseded". Optionally record which exhibit replaces it.

- **drop**: Drop an exhibit — decided not to include it. Transitions status to "dropped". Optionally record a reason.

- **review**: Record a structured review on an exhibit. Reviews are append-only and cover visual quality, data accuracy, labeling, and alignment with claims. Does not change status — the agent or user decides transitions after reading reviews.

- **list**: List exhibits with optional filters by status or kind. Only reads .yaml metadata — for full content (description, generation notes, draft caption), read the .md file at the path shown in md_path.

- **update**: Generic metadata update. Change status, label, output_path, or kind directly.

## Status lifecycle

\`\`\`
draft → rendered → verified → approved
  ↘        ↘          ↘         ↘
  dropped  dropped    dropped   superseded
\`\`\`

- draft: registered, not yet generated
- rendered: generation script has been run, output exists
- verified: data accuracy, labels, and visual quality checked
- approved: cleared for inclusion in the paper
- superseded: replaced by a newer version
- dropped: decided not to use

## Sources object

Each exhibit tracks provenance:
- experiments: which experiment IDs produced the underlying data
- claims: which claim IDs this exhibit supports or illustrates
- script: path to the generation script (e.g. "scripts/plot_fig1.py")
- data_path: path to the raw data consumed by the script

## Key rules

- Always create before render — exhibits start as draft.
- bind_sources is incremental — it merges, never overwrites existing source links.
- Reviews do not change status. Use render/verify/approve/drop/supersede for transitions.
- The .md file is your working space for description, generation notes, and draft caption.

Content and Notes:
- Pass content="## Description\n\n..." on create to document the exhibit purpose (replaces empty template).
- Pass notes="..." on render/verify/approve/supersede/drop to append status context (append-only).
- .md files are append-only research trail — never delete previous content.

Files: .research/exhibits/ (exh_XXX.yaml + exh_XXX.md + exh_XXX.reviews.jsonl)`;

const EXHIBIT_TRANSITIONS: Record<string, string[]> = {
  draft: ["rendered", "superseded", "dropped"],
  rendered: ["verified", "superseded", "dropped"],
  verified: ["approved", "superseded", "dropped"],
  approved: ["superseded", "dropped"],
  superseded: [],
  dropped: [],
};

async function readExhibit(id: string): Promise<ExhibitYaml | undefined> {
  return ResearchFS.readYaml<ExhibitYaml>(ResearchFS.resolve("exhibits", `${id}.yaml`));
}

async function writeExhibit(id: string, yaml: ExhibitYaml): Promise<void> {
  await ResearchFS.writeYaml(ResearchFS.resolve("exhibits", `${id}.yaml`), yaml);
}

async function transitionStatus(
  id: string,
  toStatus: ExhibitYaml["status"],
  extra?: { output_path?: string; superseded_by?: string; reason?: string },
): Promise<ReturnType<typeof notFound> | { title: string; output: string; metadata: Record<string, any> }> {
  const yaml = await readExhibit(id);
  if (!yaml) return notFound("Exhibit", id);

  const prevStatus = yaml.status;

  if (toStatus === prevStatus) {
    return {
      title: `${id} unchanged`,
      output: `${id} already has status "${prevStatus}".`,
      metadata: mdMeta({ id, status: prevStatus }),
    };
  }

  const allowed = EXHIBIT_TRANSITIONS[prevStatus];
  if (!allowed?.includes(toStatus)) {
    return {
      title: "Invalid transition",
      output: `Cannot transition ${id} from "${prevStatus}" to "${toStatus}". Allowed: ${(allowed ?? []).join(", ") || "none"}`,
      metadata: mdMeta({
        error: "invalid_transition",
        id,
        current: prevStatus,
        target: toStatus,
        allowed: allowed ?? [],
      }),
    };
  }

  yaml.status = toStatus;

  if (extra?.output_path) yaml.output_path = extra.output_path;
  if (extra?.superseded_by) yaml.supersedes = extra.superseded_by;

  await writeExhibit(id, yaml);

  await ResearchTimeline.append({
    type: "exhibit.status",
    id,
    from: prevStatus,
    to: toStatus,
    summary: extra?.reason ?? `${id} status: ${prevStatus} → ${toStatus}`,
  });

  const lines = [
    `✅ ${id}: ${prevStatus} → ${toStatus}`,
    ...(extra?.output_path ? [`Output: ${extra.output_path}`] : []),
    ...(extra?.superseded_by ? [`Superseded by: ${extra.superseded_by}`] : []),
    ...(extra?.reason ? [`Reason: ${extra.reason}`] : []),
  ];

  return {
    title: `${id} → ${toStatus}`,
    output: lines.join("\n"),
    metadata: mdMeta({ id, status: toStatus, previous_status: prevStatus }),
  };
}

const SourcesInput = z.object({
  experiments: z
    .array(z.string())
    .optional()
    .describe("Experiment IDs that produced the data, e.g. ['exp_003', 'exp_007']."),
  claims: z.array(z.string()).optional().describe("Claim IDs this exhibit supports, e.g. ['claim_001']."),
  script: z.string().optional().describe("Path to generation script, e.g. 'scripts/plot_fig1.py'."),
  data_path: z.string().optional().describe("Path to raw data consumed by the script."),
});

export const researchExhibit = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["create", "bind_sources", "render", "verify", "approve", "supersede", "drop", "review", "list", "update"])
      .describe("Operation to perform on an exhibit"),
    id: z.string().optional().describe("Exhibit ID (e.g. 'exh_003'). Required for all actions except create and list."),
    title: z.string().optional().describe("Exhibit title. Required for create."),
    kind: ExhibitKind.optional().describe(
      "Exhibit kind: figure, table, supplementary_figure, supplementary_table, extended_data, appendix. Required for create.",
    ),
    label: z
      .string()
      .optional()
      .describe("Short label for cross-referencing, e.g. 'fig:ablation-curve'. For create or update."),
    sources: SourcesInput.optional().describe("Provenance links. For create or bind_sources."),
    output_path: z.string().optional().describe("Path to the rendered output file. For render or update."),
    superseded_by: z.string().optional().describe("ID of the exhibit that replaces this one. For supersede."),
    reason: z.string().optional().describe("Reason for dropping the exhibit. For drop."),
    status: ExhibitStatus.optional().describe("Target status. For update."),
    force: z
      .boolean()
      .optional()
      .describe("Required with update when changing status directly; records a status_override audit trail."),
    reviewer: z
      .enum(["inspector", "auditor", "critic", "editor"])
      .optional()
      .describe("Reviewer role performing the review"),
    summary: z.string().optional().describe("Review summary. Required for review."),
    focus: z.string().optional().describe("What aspect was reviewed (e.g. 'data accuracy and labeling'). For review."),
    verdict: ReviewVerdict.optional().describe("Review verdict: pass, revise, or rethink. For review."),
    action_items: z.array(z.string()).optional().describe("Actionable follow-ups from review. For review."),
    scores: z
      .record(z.string(), z.number())
      .optional()
      .describe("Numeric scores (e.g. {visual_quality: 8, accuracy: 9}). For review."),
    review_body: z
      .string()
      .optional()
      .describe(
        "Reviewer's full markdown feedback. ONLY for review action. Saved as a separate .review.NNN.md file (not the entity's main .md).",
      ),
    filter_status: ExhibitStatus.optional().describe("Filter by status. For list."),
    filter_kind: ExhibitKind.optional().describe("Filter by kind. For list."),
    content: z
      .string()
      .optional()
      .describe(
        "Initial .md content for create. Write ## Description, ## Generation Notes, ## Caption. Replaces empty template.",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Append to .md on render/verify/approve/supersede/drop. Record review feedback or generation details. Auto-timestamped, append-only.",
      ),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(exhibitMutex, async () => {
        if (!(await ResearchFS.isInitialized())) return notInitialized();
        const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
        const activePhaseRun = state?.focus?.active_phase_run;

        if (params.action === "create") {
          if (!params.title) return missingParam("title", "Please provide a title for the exhibit.");
          if (!params.kind)
            return missingParam(
              "kind",
              "Please provide a kind (figure, table, supplementary_figure, supplementary_table, extended_data, appendix).",
            );

          const id = await ResearchId.next("exh");
          const now = new Date().toISOString();

          const yaml: ExhibitYaml = {
            id,
            title: params.title,
            kind: params.kind,
            status: "draft",
            label: params.label,
            sources: {
              experiments: params.sources?.experiments ?? [],
              claims: params.sources?.claims ?? [],
              script: params.sources?.script,
              data_path: params.sources?.data_path,
            },
            output_path: undefined,
            created: now,
          };
          await writeExhibit(id, yaml);

          const md =
            params.content ??
            [
              `## Description`,
              "",
              "(what this exhibit shows and why it matters)",
              "",
              `## Generation Notes`,
              "",
              "(how to reproduce: script, parameters, data source)",
              "",
              `## Caption`,
              "",
              "(draft caption for the paper)",
              "",
            ].join("\n");
          await ResearchFS.writeMd(ResearchFS.resolve("exhibits", `${id}.md`), md);

          const refs: string[] = [];
          if (params.sources?.experiments) refs.push(...params.sources.experiments);
          if (params.sources?.claims) refs.push(...params.sources.claims);

          await ResearchTimeline.append({
            type: "exhibit.created",
            id,
            title: params.title,
            summary: `${params.kind}: ${params.title}`,
            refs: refs.length > 0 ? refs : undefined,
          });

          await updateActivePhaseRun(
            "compose",
            {
              incrementAttempts: true,
              summary: `Created exhibit ${id}: ${params.title}`,
            },
            activePhaseRun,
          );

          return {
            title: `Exhibit registered: ${id}`,
            output: [
              `✅ Registered ${id}: ${params.title}`,
              "",
              `Files:`,
              `  .research/exhibits/${id}.yaml (metadata)`,
              `  .research/exhibits/${id}.md (${params.content ? "content written" : "template — fill with description, generation notes, caption"})`,
              "",
              `Status: draft`,
              `Kind: ${params.kind}`,
              ...(params.label ? [`Label: ${params.label}`] : []),
              ...(params.sources?.experiments?.length ? [`Experiments: ${params.sources.experiments.join(", ")}`] : []),
              ...(params.sources?.claims?.length ? [`Claims: ${params.sources.claims.join(", ")}`] : []),
              ...(params.sources?.script ? [`Script: ${params.sources.script}`] : []),
              ...(params.sources?.data_path ? [`Data: ${params.sources.data_path}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id, path: `.research/exhibits/${id}` }),
          };
        }

        if (params.action === "bind_sources") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID (e.g. "exh_003").');

          const yaml = await readExhibit(params.id);
          if (!yaml) return notFound("Exhibit", params.id);

          if (!yaml.sources) {
            yaml.sources = { experiments: [], claims: [] };
          }

          const added: string[] = [];

          if (params.sources?.experiments) {
            for (const exp of params.sources.experiments) {
              if (!yaml.sources.experiments.includes(exp)) {
                yaml.sources.experiments.push(exp);
                added.push(exp);
              }
            }
          }
          if (params.sources?.claims) {
            for (const cl of params.sources.claims) {
              if (!yaml.sources.claims.includes(cl)) {
                yaml.sources.claims.push(cl);
                added.push(cl);
              }
            }
          }
          if (params.sources?.script) {
            yaml.sources.script = params.sources.script;
            added.push(`script=${params.sources.script}`);
          }
          if (params.sources?.data_path) {
            yaml.sources.data_path = params.sources.data_path;
            added.push(`data_path=${params.sources.data_path}`);
          }

          await writeExhibit(params.id, yaml);

          await ResearchTimeline.append({
            type: "exhibit.bind_sources",
            phase: "compose",
            summary: `Exhibit ${params.id} sources bound`,
            id: params.id,
          });

          return {
            title: `${params.id} sources updated`,
            output: [
              `✅ Bound sources to ${params.id}`,
              "",
              `Added: ${added.length > 0 ? added.join(", ") : "(no new sources)"}`,
              "",
              `Current sources:`,
              `  Experiments: ${yaml.sources.experiments.length > 0 ? yaml.sources.experiments.join(", ") : "(none)"}`,
              `  Claims: ${yaml.sources.claims.length > 0 ? yaml.sources.claims.join(", ") : "(none)"}`,
              `  Script: ${yaml.sources.script ?? "(none)"}`,
              `  Data: ${yaml.sources.data_path ?? "(none)"}`,
            ].join("\n"),
            metadata: mdMeta({ id: params.id, sources: yaml.sources }),
          };
        }

        if (params.action === "render") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID (e.g. "exh_003").');
          const result = await transitionStatus(params.id, "rendered", { output_path: params.output_path });
          if (params.notes) await appendNotes("exhibits", params.id, "Render", params.notes);
          await updateActivePhaseRun("compose", { summary: `Rendered exhibit ${params.id}` }, activePhaseRun);
          return result;
        }

        if (params.action === "verify") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID (e.g. "exh_003").');
          const result = await transitionStatus(params.id, "verified");
          if (params.notes) await appendNotes("exhibits", params.id, "Verify", params.notes);
          await updateActivePhaseRun("compose", { summary: `Verified exhibit ${params.id}` }, activePhaseRun);
          return result;
        }

        if (params.action === "approve") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID (e.g. "exh_003").');
          const result = await transitionStatus(params.id, "approved");
          if (params.notes) await appendNotes("exhibits", params.id, "Approve", params.notes);
          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Approved exhibit ${params.id}` },
            activePhaseRun,
          );
          return result;
        }

        if (params.action === "supersede") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID (e.g. "exh_003").');
          const result = await transitionStatus(params.id, "superseded", { superseded_by: params.superseded_by });
          if (params.notes) await appendNotes("exhibits", params.id, "Supersede", params.notes);
          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Superseded exhibit ${params.id}` },
            activePhaseRun,
          );
          return result;
        }

        if (params.action === "drop") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID (e.g. "exh_003").');
          const result = await transitionStatus(params.id, "dropped", { reason: params.reason });
          if (params.notes) await appendNotes("exhibits", params.id, "Drop", params.notes);
          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Dropped exhibit ${params.id}` },
            activePhaseRun,
          );
          return result;
        }

        if (params.action === "review") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID to review (e.g. "exh_003").');
          if (!params.reviewer) return missingParam("reviewer", "Please provide the reviewer identity.");
          if (!params.summary) return missingParam("summary", "Please provide a review summary.");

          const yaml = await readExhibit(params.id);
          if (!yaml) return notFound("Exhibit", params.id);

          const { round, review_file } = await ResearchReview.addReview("exhibits", params.id, {
            reviewer: params.reviewer,
            focus: params.focus,
            verdict: params.verdict,
            summary: params.summary,
            action_items: params.action_items,
            scores: params.scores,
            review_body: params.review_body,
          });

          await ResearchTimeline.append({
            type: "exhibit.reviewed",
            id: params.id,
            summary: `Review round ${round} by ${params.reviewer}: ${params.verdict ?? "no verdict"} — ${params.summary}`,
          });

          await updateActivePhaseRun(
            "compose",
            {
              state: "evaluate",
              summary: `Review round ${round}: ${params.verdict ?? "no verdict"} — ${params.summary}`,
            },
            activePhaseRun,
          );

          return {
            title: `${params.id} reviewed (round ${round})`,
            output: ResearchReview.formatReviewOutput(params.id, round, {
              reviewer: params.reviewer,
              verdict: params.verdict,
              summary: params.summary,
              scores: params.scores,
              review_file,
            }),
            metadata: mdMeta({ id: params.id, round, verdict: params.verdict }),
          };
        }

        if (params.action === "update") {
          if (!params.id) return missingParam("id", 'Please provide the exhibit ID to update (e.g. "exh_003").');

          if (params.status && params.force !== true) {
            return {
              title: "Status change requires force=true",
              output: `Status changes via update require force=true. Prefer semantic actions (render, verify, approve, supersede, drop) for lifecycle transitions. Use force=true only when you have explicit justification to bypass transition validation.`,
              metadata: mdMeta({ error: "force_required", id: params.id, target_status: params.status }),
            };
          }

          const yaml = await readExhibit(params.id);
          if (!yaml) return notFound("Exhibit", params.id);

          const prevStatus = yaml.status;
          const changes: string[] = [];

          if (params.status && params.status !== prevStatus) {
            log.warn(
              "Transition",
              `Bypassing transition validation via update action: ${prevStatus} → ${params.status}`,
            );
            yaml.status = params.status;
            changes.push(`status: ${prevStatus} → ${params.status}`);
          }
          if (params.label !== undefined) {
            yaml.label = params.label;
            changes.push(`label: ${params.label}`);
          }
          if (params.output_path) {
            yaml.output_path = params.output_path;
            changes.push(`output_path: ${params.output_path}`);
          }
          if (params.kind) {
            yaml.kind = params.kind;
            changes.push(`kind: ${params.kind}`);
          }

          await writeExhibit(params.id, yaml);

          if (params.status && params.status !== prevStatus) {
            await ResearchTimeline.append({
              type: "exhibit.status",
              id: params.id,
              from: prevStatus,
              to: params.status,
              summary: `${params.id} status: ${prevStatus} → ${params.status}`,
            });
            await ResearchTimeline.append({
              type: "entity.status_override",
              phase: "compose",
              summary: `${params.id} status overridden: ${prevStatus} → ${params.status}`,
              id: params.id,
            });
            await ResearchJournal.appendAgentNote({
              phase: "compose",
              kind: "status_override",
              refs: [params.id],
              summary: `${params.id} status overridden via update: ${prevStatus} → ${params.status}`,
              note: `Transition validation was bypassed via the update action.`,
              importance: "critical",
            });
            if (isTerminalTransition(prevStatus, params.status, EXHIBIT_TRANSITIONS)) {
              log.warn(
                "TerminalOverride",
                `CRITICAL: ${params.id} leaving terminal state "${prevStatus}" → "${params.status}"`,
              );
              await ResearchJournal.appendAgentNote({
                phase: "compose",
                kind: "status_override",
                refs: [params.id],
                summary: `CRITICAL: ${params.id} leaving terminal state "${prevStatus}" → "${params.status}"`,
                note: `Entity was in terminal state "${prevStatus}" (no valid outgoing transitions) and has been moved to "${params.status}" via the update action. This should only happen with explicit justification.`,
                importance: "critical",
              });
            }
          }

          return {
            title: `${params.id} updated`,
            output: [
              `✅ Updated ${params.id}`,
              "",
              ...(changes.length > 0 ? changes.map((c) => `  ${c}`) : ["  (no changes)"]),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: yaml.status }),
          };
        }

        if (params.action === "list") {
          const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("exhibits"));
          const exhibits: ExhibitYaml[] = [];

          for (const file of yamlFiles) {
            const yaml = await ResearchFS.readYaml<ExhibitYaml>(ResearchFS.resolve("exhibits", file));
            if (yaml) exhibits.push(yaml);
          }

          let filtered = exhibits;
          if (params.filter_status) filtered = filtered.filter((e) => e.status === params.filter_status);
          if (params.filter_kind) filtered = filtered.filter((e) => e.kind === params.filter_kind);

          if (filtered.length === 0) {
            return {
              title: "Exhibits",
              output: "No exhibits found.",
              metadata: mdMeta({ count: 0 }),
            };
          }

          const statusIcon: Record<string, string> = {
            draft: "📝",
            rendered: "🖼️",
            verified: "✔️",
            approved: "✅",
            superseded: "🔄",
            dropped: "❌",
          };

          const lines = [`=== Exhibits (${filtered.length}) ===`, ""];

          for (const exh of filtered) {
            const icon = statusIcon[exh.status] ?? "•";
            const labelStr = exh.label ? ` [${exh.label}]` : "";
            const srcCount = (exh.sources?.experiments?.length ?? 0) + (exh.sources?.claims?.length ?? 0);
            const srcStr = srcCount > 0 ? ` — ${srcCount} source(s)` : "";
            lines.push(
              `${icon} ${exh.id}  ${exh.title}  (${exh.kind}, ${exh.status})${labelStr}${srcStr}  → ${entityMdPath(exh.id)}`,
            );
          }

          return {
            title: "Exhibits",
            output: lines.join("\n"),
            metadata: mdMeta({
              count: filtered.length,
              exhibits: filtered.map((e) => ({
                id: e.id,
                title: e.title,
                status: e.status,
                kind: e.kind,
                md_path: entityMdPath(e.id),
              })),
            }),
          };
        } // end list action
        else {
          return {
            title: "Unknown action",
            output: `Unknown action "${params.action}". Valid actions are: create, bind_sources, render, verify, approve, supersede, drop, review, list, update.`,
            metadata: mdMeta({ error: "unknown_action" }),
          };
        }
      });
    });
  },
});
