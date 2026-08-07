import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { MonitorBoard } from "../monitor";
import { ProjectPhase } from "../schema";
import { mdMeta, notInitialized, withGuard } from "./shared";

// Module-level singleton — reuses caches across tool calls
const monitorBoard = new MonitorBoard();

const DESCRIPTION = `Monitor board — real-time research project dashboard.

Provides aggregated views of the research workflow, entities, timeline, journal, and active phase run. This is a read-only tool (no mutations).

## Actions

- **action="workflow"**: Returns workflow visualization data — current phase, blocked status, and the state of all 6 phases (explore → ground → design → realize → experiment → compose) with completion/pending flags.

- **action="phase"**: Returns detailed info for a specific phase. Requires phase param. Includes active runs, all historical runs in that phase, refs, and human checkpoints.

- **action="entities"**: Returns entity summary — counts and status breakdowns for all 7 entity types (ideas, plans, experiments, claims, exhibits, papers, submissions), plus current focus refs.

- **action="timeline"**: Returns recent timeline events (default last 20). Use limit param to adjust count, type param to filter by event type (e.g. "idea.created", "wiki.paper_ingested"), since param for ISO timestamp lower bound, or refs param to filter by entity IDs (comma-separated).

- **action="journal"**: Returns recent journal notes (default last 20). Use limit param to adjust.

- **action="active_run"**: Returns the currently active phase run with full context (state, run details, focus summary, blocked status).

Files: .research/state.yaml, .research/phase_runs/, .research/timeline.jsonl, .research/journal/, .research/{ideas,plans,experiments,claims,exhibits,manuscripts,submissions}/`;

export const researchMonitor = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["workflow", "phase", "entities", "timeline", "journal", "active_run"])
      .describe("Monitor action: workflow, phase, entities, timeline, journal, or active_run"),
    phase: ProjectPhase.optional().describe(
      "Target phase for action='phase'. One of: explore, ground, design, realize, experiment, compose.",
    ),
    limit: z.number().optional().describe("Number of recent items to return for timeline/journal. Default 20."),
    type: z
      .string()
      .optional()
      .describe(
        "Filter timeline by event type (e.g. 'idea.created', 'wiki.paper_ingested'). Only for action='timeline'.",
      ),
    since: z.string().optional().describe("ISO timestamp lower bound for timeline events. Only for action='timeline'."),
    refs: z
      .string()
      .optional()
      .describe("Comma-separated entity IDs to filter timeline events by. Only for action='timeline'."),
  },
  async execute(params) {
    return withGuard(async () => {
      if (!(await ResearchFS.isInitialized())) return notInitialized();

      if (params.action === "workflow") {
        const status = await monitorBoard.getWorkflowStatus();
        const lines = [
          "=== Workflow Status ===",
          "",
          `Current Phase: ${status.current_phase ?? "(not set)"}`,
          ...(status.current_phase_since ? [`Since: ${status.current_phase_since.slice(0, 19)}Z`] : []),
          ...(status.blocked_on ? [`⚠ Blocked on: ${status.blocked_on}`] : []),
          ...(status.anchor ? [`Anchor: ${status.anchor}`] : []),
          ...(status.next ? [`Next: ${status.next}`] : []),
          "",
          "Phases:",
        ];
        for (const p of status.phases) {
          const icon = p.is_current ? "▶" : p.is_completed ? "✓" : p.is_pending ? "○" : "•";
          lines.push(`  ${icon} ${p.order}. ${p.name}`);
        }

        return {
          title: "Workflow Status",
          output: lines.join("\n"),
          metadata: mdMeta({ status }),
        };
      }

      if (params.action === "phase") {
        if (!params.phase) {
          return {
            title: "Missing phase",
            output:
              "phase param is required for action='phase'. Use one of: explore, ground, design, realize, experiment, compose.",
            metadata: mdMeta({ error: "missing_phase" }),
          };
        }
        const details = await monitorBoard.getPhaseDetails(params.phase);

        const lines = [
          `=== Phase: ${details.phase} ===`,
          "",
          `Active runs: ${details.active_runs.length}`,
          `Total runs:  ${details.all_runs.length}`,
          "",
        ];

        if (details.active_runs.length) {
          lines.push("Active Runs:");
          for (const run of details.active_runs) {
            lines.push(`  • ${run.id} [${run.status}] since ${run.created.slice(0, 19)}Z`);
            lines.push(
              `    inner_loop: ${run.inner_loop.state} (round ${run.inner_loop.round}, attempts ${run.inner_loop.attempts})`,
            );
            if (run.summary) lines.push(`    summary: ${run.summary}`);
          }
          lines.push("");
        }

        const pendingCheckpoints = details.checkpoints.filter((cp) => cp.status === "pending");
        if (pendingCheckpoints.length) {
          lines.push("Pending Checkpoints:");
          for (const cp of pendingCheckpoints) {
            lines.push(`  • [${cp.kind}] ${cp.question ?? ""}`);
          }
          lines.push("");
        }

        if (details.all_runs.length > details.active_runs.length) {
          lines.push("Historical Runs:");
          for (const run of details.all_runs.filter((r) => r.status !== "active")) {
            lines.push(`  • ${run.id} [${run.status}] ${run.created.slice(0, 19)}Z`);
          }
          lines.push("");
        }

        return {
          title: `Phase: ${details.phase}`,
          output: lines.join("\n"),
          metadata: mdMeta({ details }),
        };
      }

      if (params.action === "entities") {
        const summary = await monitorBoard.getEntitySummary();
        const c = summary.counts;
        const lines = [
          "=== Entity Summary ===",
          "",
          `Ideas:       ${c.ideas}`,
          `Plans:       ${c.plans}`,
          `Experiments: ${c.experiments}`,
          `Claims:      ${c.claims}`,
          `Exhibits:    ${c.exhibits}`,
          `Papers:      ${c.papers}`,
          `Submissions: ${c.submissions}`,
          "",
          "Status Breakdown:",
        ];
        for (const [entity, statuses] of Object.entries(summary.by_status)) {
          const parts = Object.entries(statuses)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([s, n]) => `${n} ${s}`);
          if (parts.length) {
            lines.push(`  ${entity}: ${parts.join(", ")}`);
          } else {
            lines.push(`  ${entity}: (none)`);
          }
        }

        const refs = summary.focus_refs;
        const hasRefs =
          refs.idea ||
          refs.plan ||
          refs.experiments.length ||
          refs.claims.length ||
          refs.exhibits.length ||
          refs.paper ||
          refs.submission;
        if (hasRefs) {
          lines.push("", "Focus Refs:");
          if (refs.idea) lines.push(`  Idea: ${refs.idea}`);
          if (refs.plan) lines.push(`  Plan: ${refs.plan}`);
          if (refs.experiments.length) lines.push(`  Experiments: ${refs.experiments.join(", ")}`);
          if (refs.claims.length) lines.push(`  Claims: ${refs.claims.join(", ")}`);
          if (refs.exhibits.length) lines.push(`  Exhibits: ${refs.exhibits.join(", ")}`);
          if (refs.paper) lines.push(`  Paper: ${refs.paper}`);
          if (refs.submission) lines.push(`  Submission: ${refs.submission}`);
        }

        return {
          title: "Entity Summary",
          output: lines.join("\n"),
          metadata: mdMeta({ summary }),
        };
      }

      if (params.action === "timeline") {
        const opts: import("../timeline").ResearchTimeline.QueryOptions = { last: params.limit ?? 20 };
        if (params.type) opts.type = params.type;
        if (params.since) opts.since = params.since;
        if (params.refs) opts.refs = params.refs.split(",").filter(Boolean);
        const preview = await monitorBoard.getTimelinePreview(opts);
        if (preview.events.length === 0) {
          return {
            title: "Timeline Preview",
            output: "No timeline events yet.",
            metadata: mdMeta({ count: 0 }),
          };
        }
        const lines = [`=== Timeline (last ${preview.events.length}) ===`, ""];
        for (const e of preview.events) {
          const ts = e.ts.replace("T", " ").replace(/\.\d+Z$/, "");
          const idStr = e.id ? ` [${e.id}]` : "";
          const transition = e.from && e.to ? ` ${e.from} → ${e.to}` : "";
          const summaryStr = e.summary ? ` — ${e.summary}` : "";
          lines.push(`${ts}  ${e.type}${idStr}${transition}${summaryStr}`);
        }
        return {
          title: "Timeline Preview",
          output: lines.join("\n"),
          metadata: mdMeta({ count: preview.count, events: preview.events }),
        };
      }

      if (params.action === "journal") {
        const preview = await monitorBoard.getJournalPreview(params.limit ?? 20);
        if (preview.notes.length === 0) {
          return {
            title: "Journal Preview",
            output: "No journal notes yet.",
            metadata: mdMeta({ count: 0 }),
          };
        }
        const lines = [`=== Journal (last ${preview.notes.length}) ===`, ""];
        for (const n of preview.notes) {
          const ts = n.ts.replace("T", " ").replace(/\.\d+Z$/, "");
          const icon = n.importance === "critical" ? "🔴" : n.importance === "important" ? "🟡" : "📝";
          lines.push(`${ts}  ${icon} [${n.author}] ${n.kind}${n.phase ? ` (${n.phase})` : ""}: ${n.summary}`);
          if (n.note) lines.push(`    ${n.note}`);
        }
        return {
          title: "Journal Preview",
          output: lines.join("\n"),
          metadata: mdMeta({ count: preview.count, notes: preview.notes }),
        };
      }

      // action === "active_run"
      const active = await monitorBoard.getActivePhaseRun();
      if (!active.run) {
        const lines = [
          "=== Active Phase Run ===",
          "",
          "No active phase run.",
          ...(active.state?.focus?.phase ? [`Current phase: ${active.state.focus.phase}`] : []),
          ...(active.context.blocked_on ? [`Blocked on: ${active.context.blocked_on}`] : []),
        ];
        return {
          title: "No Active Phase Run",
          output: lines.join("\n"),
          metadata: mdMeta({ active }),
        };
      }

      const run = active.run;
      const lines = [
        `=== Active Phase Run: ${run.id} ===`,
        "",
        `Phase: ${run.phase}`,
        `Status: ${run.status}`,
        `Created: ${run.created.slice(0, 19)}Z`,
        ...(run.summary ? [`Summary: ${run.summary}`] : []),
        "",
        "Inner Loop:",
        `  State: ${run.inner_loop.state}`,
        `  Round: ${run.inner_loop.round}`,
        `  Attempts: ${run.inner_loop.attempts}`,
        `  Stagnation: ${run.inner_loop.stagnation_rounds}`,
        ...(run.inner_loop.last_decision ? [`  Last decision: ${run.inner_loop.last_decision}`] : []),
        ...(run.inner_loop.summary ? [`  Summary: ${run.inner_loop.summary}`] : []),
        "",
      ];

      if (run.refs) {
        const r = run.refs;
        const hasAny =
          r.idea_ref ||
          r.plan_ref ||
          r.experiment_refs?.length ||
          r.claim_refs?.length ||
          r.exhibit_refs?.length ||
          r.paper_ref ||
          r.submission_ref;
        if (hasAny) {
          lines.push("Refs:");
          if (r.idea_ref) lines.push(`  Idea: ${r.idea_ref}`);
          if (r.plan_ref) lines.push(`  Plan: ${r.plan_ref}`);
          if (r.experiment_refs?.length) lines.push(`  Experiments: ${r.experiment_refs.join(", ")}`);
          if (r.claim_refs?.length) lines.push(`  Claims: ${r.claim_refs.join(", ")}`);
          if (r.exhibit_refs?.length) lines.push(`  Exhibits: ${r.exhibit_refs.join(", ")}`);
          if (r.paper_ref) lines.push(`  Paper: ${r.paper_ref}`);
          if (r.submission_ref) lines.push(`  Submission: ${r.submission_ref}`);
          lines.push("");
        }
      }

      const pendingCP = run.human_checkpoints.filter((cp) => cp.status === "pending");
      if (pendingCP.length) {
        lines.push("Pending Checkpoints:");
        for (const cp of pendingCP) {
          lines.push(`  • [${cp.kind}] ${cp.question ?? ""}`);
        }
        lines.push("");
      }

      if (active.context.blocked_on) {
        lines.push(`⚠ Blocked on: ${active.context.blocked_on}`);
      }
      if (active.context.focus_next) {
        lines.push(`Next: ${active.context.focus_next}`);
      }

      return {
        title: `Active Run: ${run.id}`,
        output: lines.join("\n"),
        metadata: mdMeta({ active }),
      };
    });
  },
});
