import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { ResearchJournal } from "../journal";
import type { JournalNote } from "../schema";
import { mdMeta, notInitialized, withGuard } from "./shared";

const JOURNAL_KINDS = [
  "idea_rationale",
  "decision_rationale",
  "failure_analysis",
  "design_note",
  "experiment_note",
  "claim_note",
  "paper_note",
  "handoff",
  "status_override",
  "opportunity_spotted",
] as const;

const PROJECT_PHASES = ["explore", "ground", "design", "realize", "experiment", "compose"] as const;

const DESCRIPTION = `Research journal — append-only structured notes for decisions, rationales, opportunities spotted mid-batch, and handoffs.

The journal is the canonical place to record *why* something was done (vs. timeline.jsonl which records *what*). Skills route to this tool for decision_rationale, opportunity_spotted (mid-batch ideas you should NOT act on yet), failure_analysis, etc.

## Actions

- **action="append"**: Append a new journal note. Required: kind, summary, note. Optional: phase, phase_run_ref, refs, importance, author (defaults to "agent"), source_event.
- **action="read"** / **action="query"**: List recent journal notes (synonyms). Optional filters: last (N most recent), kind, phase, phase_run_ref, refs (any-match), importance.

## Kinds

- \`idea_rationale\` — why an idea was created / refined
- \`decision_rationale\` — why a decision was made (most common)
- \`failure_analysis\` — postmortem on a failed experiment / pivot
- \`design_note\` / \`experiment_note\` / \`claim_note\` / \`paper_note\` — phase-scoped working notes
- \`handoff\` — context preservation across sessions
- \`status_override\` — note attached to a force/bypass action
- \`opportunity_spotted\` — promising idea / approach surfaced mid-batch (do NOT act on it immediately; record + finish current batch first)

## Importance

\`normal\` (default) | \`important\` | \`critical\` — surfaced more prominently in monitor / brief generation.

Files: .research/journal/research_notes.jsonl (append-only JSONL).`;

export const researchJournal = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["append", "read", "query"])
      .describe("append a new note, or read/query recent notes (read/query are synonyms)"),
    // append params
    kind: z.enum(JOURNAL_KINDS).optional().describe("kind of note (required for append)"),
    summary: z.string().optional().describe("one-line summary (required for append)"),
    note: z.string().optional().describe("full note body (required for append)"),
    phase: z.enum(PROJECT_PHASES).optional().describe("phase the note relates to"),
    phase_run_ref: z.string().optional().describe("phase run ID the note relates to"),
    refs: z.array(z.string()).optional().describe("entity IDs this note references (for filtering)"),
    importance: z.enum(["normal", "important", "critical"]).optional().describe("importance level (default normal)"),
    author: z.enum(["human", "agent", "tool", "subagent"]).optional().describe("who authored the note (default agent)"),
    source_event: z.string().optional().describe("optional source event ID (e.g. a timeline event)"),
    // read/query params
    last: z.number().optional().describe("for read/query: return only the last N matching notes"),
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

      if (params.action === "append") {
        if (!params.kind || !params.summary || !params.note) {
          return {
            title: "Missing required fields",
            output: "append requires kind, summary, and note.",
            metadata: mdMeta({
              error: "missing_required",
              missing: ["kind", "summary", "note"].filter((f) => !(params as any)[f]),
            }),
          };
        }

        const entry = await ResearchJournal.appendNote({
          author: params.author ?? "agent",
          phase: params.phase,
          phase_run_ref: params.phase_run_ref,
          kind: params.kind,
          importance: params.importance ?? "normal",
          refs: params.refs ?? [],
          summary: params.summary,
          note: params.note,
          source_event: params.source_event,
        });

        return {
          title: `Journal note appended (${entry.kind})`,
          output: [
            `✅ Journal note ${entry.id} appended`,
            `Kind: ${entry.kind}  ·  Author: ${entry.author}  ·  Importance: ${entry.importance}`,
            ...(entry.phase ? [`Phase: ${entry.phase}`] : []),
            `Summary: ${entry.summary}`,
            "",
            `File: .research/journal/research_notes.jsonl`,
          ].join("\n"),
          metadata: mdMeta({
            id: entry.id,
            kind: entry.kind,
            ts: entry.ts,
            phase: entry.phase,
            phase_run_ref: entry.phase_run_ref,
          }),
        };
      }

      // read / query (synonyms)
      const notes = await ResearchJournal.queryNotes({
        phase: params.phase,
        phase_run_ref: params.phase_run_ref,
        kind: params.kind,
        importance: params.importance,
        refs: params.refs,
        last: params.last,
      });

      if (notes.length === 0) {
        return {
          title: "No journal notes match",
          output: "No notes match the given filters.",
          metadata: mdMeta({ count: 0 }),
        };
      }

      const lines = notes.map((n: JournalNote) => {
        const meta = [n.ts, n.kind, n.author, n.importance].filter(Boolean).join(" · ");
        const refsStr = n.refs.length > 0 ? `  refs=[${n.refs.join(", ")}]` : "";
        return `[${n.id}] ${meta}${refsStr}\n  ${n.summary}\n  ${n.note.length > 200 ? n.note.slice(0, 200) + "…" : n.note}`;
      });

      return {
        title: `Journal notes (${notes.length})`,
        output: lines.join("\n\n"),
        metadata: mdMeta({
          count: notes.length,
          last_id: notes.length > 0 ? notes[notes.length - 1]!.id : null,
          last_ts: notes.length > 0 ? notes[notes.length - 1]!.ts : null,
        }),
      };
    });
  },
});
