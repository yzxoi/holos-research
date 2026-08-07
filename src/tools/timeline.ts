import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { ResearchTimeline } from "../timeline";
import { mdMeta, notInitialized, withGuard } from "./shared";

const DESCRIPTION = `Query or annotate the research timeline — the append-only event log tracking the full trajectory of a research project.

This is a SUPPORT tool. Most timeline events are written automatically by object tools (research_idea, research_plan, research_experiment, research_claim, research_exhibit, research_paper, research_submission). You do NOT need to call this tool to record those events.

Actions:
- action="read" — Query timeline events with optional filters. Use this to review research history, understand how the project reached its current state, or trace the evolution of specific objects.
- action="append_free_event" — Manually append a free event (insight, milestone, or decision). Only for research-level observations that don't naturally attach to a specific object tool operation.

Filter examples for read:
- type="exp.*" — all experiment events (exp.created, exp.status, exp.reviewed)
- type="claim.*" — all claim events
- type=".*reviewed" — all review events across all object types
- type="focus.*" — focus changes
- refs=["idea_003", "exp_012"] — events referencing specific entities
- last=20 — most recent 20 events

Free event types for append_free_event:
- insight — a key research observation, e.g. "Gradient detachment in residual branch is the root cause"
- milestone — a significant achievement, e.g. "Main method validated: +2.1 BLEU across 3 seeds"
- decision — a research direction change, e.g. "Switching from dynamic to static pruning based on ablation results"

Files: .research/timeline.jsonl (append-only, auto-written by object tools)`;

export const researchTimeline = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["read", "append_free_event"])
      .describe("'read' to query events, 'append_free_event' to record an insight/milestone/decision"),

    since: z.string().optional().describe("ISO date lower bound, e.g. '2026-06-01'. Read only."),
    type: z
      .string()
      .optional()
      .describe("Regex filter against event type, e.g. 'exp.*', '.*reviewed', 'claim.status'. Read only."),
    refs: z
      .array(z.string())
      .optional()
      .describe("Filter to events referencing these entity IDs, e.g. ['idea_003', 'exp_012']. Read only."),
    last: z.number().optional().describe("Return only the last N events. Read only."),

    event_type: z
      .enum(["insight", "milestone", "decision"])
      .optional()
      .describe("Free event type. Required for append_free_event."),
    summary: z.string().optional().describe("Event description. Required for append_free_event."),
    event_refs: z
      .array(z.string())
      .optional()
      .describe("Entity IDs this event relates to, e.g. ['exp_005']. append_free_event only."),
  },
  async execute(params) {
    return withGuard(async () => {
      if (!(await ResearchFS.isInitialized())) return notInitialized();

      if (params.action === "read") {
        const events = await ResearchTimeline.query({
          since: params.since,
          type: params.type,
          refs: params.refs,
          last: params.last,
        });

        if (events.length === 0) {
          return {
            title: "Timeline",
            output: "No timeline events match the given filters.",
            metadata: mdMeta({ count: 0 }),
          };
        }

        const lines = [`=== Timeline (${events.length} events) ===`, ""];

        for (const e of events) {
          const ts = e.ts.replace("T", " ").replace(/\.\d+Z$/, "");
          const idStr = e.id ? ` [${e.id}]` : "";
          const titleStr = e.title ? ` ${e.title}` : "";
          const transition = e.from && e.to ? ` ${e.from} → ${e.to}` : "";
          const byStr = e.by ? ` (by ${e.by})` : "";
          const summaryStr = e.summary ? ` — ${e.summary}` : "";

          if (transition) {
            lines.push(`${ts}  ${e.type}${idStr}${transition}${byStr}${summaryStr}`);
          } else {
            lines.push(`${ts}  ${e.type}${idStr}${titleStr}${summaryStr}`);
          }
        }

        return {
          title: "Timeline",
          output: lines.join("\n"),
          metadata: mdMeta({ count: events.length }),
        };
      }

      if (!params.event_type) {
        return {
          title: "Missing event_type",
          output: "event_type is required for append_free_event. Use: insight, milestone, or decision.",
          metadata: mdMeta({ error: "missing_event_type" }),
        };
      }

      if (!params.summary) {
        return {
          title: "Missing summary",
          output: "summary is required for append_free_event.",
          metadata: mdMeta({ error: "missing_summary" }),
        };
      }

      await ResearchTimeline.append({
        type: params.event_type,
        refs: params.event_refs,
        summary: params.summary,
      });

      return {
        title: "Event appended",
        output: `Appended ${params.event_type} event to .research/timeline.jsonl\n\n  ${params.summary}`,
        metadata: mdMeta({ type: params.event_type }),
      };
    });
  },
});
