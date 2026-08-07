import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { ResearchId } from "../id";
import { ResearchJournal } from "../journal";
import { withLock } from "../lock";
import { log } from "../log";
import { updateActivePhaseRun } from "../phase-run";
import { ResearchReview } from "../review";
import type { IdeaYaml, StateYaml } from "../schema";
import { IdeaStatus, ReviewVerdict } from "../schema";
import { StoryManager } from "../story";
import { ResearchTimeline } from "../timeline";
import {
  appendNotes,
  entityMdPath,
  ideaMutex,
  isTerminalTransition,
  mdMeta,
  missingParam,
  notFound,
  notInitialized,
  withGuard,
} from "./shared";

function extractSection(content: string, heading: string): string | undefined {
  const regex = new RegExp(`##\\s*${heading}\\s*\\n(.*?)(?=\\n##\\s|$)`, "is");
  const match = regex.exec(content);
  return match && match.length > 1 ? match[1]!.trim() : undefined;
}

function parseStoryFields(content: string | undefined): {
  field_assumption: string;
  pain_point: string;
  non_obvious_insight: string;
  why_now?: string;
  what_changes_if_true: string;
} {
  if (!content) {
    return {
      field_assumption: "(to be defined)",
      pain_point: "(to be defined)",
      non_obvious_insight: "(to be defined)",
      what_changes_if_true: "(to be defined)",
    };
  }

  const field_assumption =
    extractSection(content, "Field Assumption") ?? extractSection(content, "Core Insight") ?? "(to be defined)";
  const pain_point = extractSection(content, "Pain Point") ?? "(to be defined)";
  const non_obvious_insight =
    extractSection(content, "Non-obvious Insight") ?? extractSection(content, "Novelty Analysis") ?? "(to be defined)";
  const why_now = extractSection(content, "Why Now") ?? undefined;
  const what_changes_if_true =
    extractSection(content, "What Changes If True") ?? extractSection(content, "Feasibility") ?? "(to be defined)";

  return { field_assumption, pain_point, non_obvious_insight, why_now, what_changes_if_true };
}

const DESCRIPTION = `Manage research ideas — candidate research directions, core insights, and contribution hypotheses.

An idea is a named research direction with a lifecycle: it starts as "proposed", gets explored and grounded against existing work, and is eventually selected as the project's focus, parked for later, or rejected. Ideas are the entry point to the entire research pipeline — every plan, experiment, and claim ultimately traces back to one.

## Actions

- **create**: Register a new idea. Assigns an auto-incrementing ID (e.g. idea_015), creates a .yaml (metadata managed by this tool) and a .md template (content you edit freely: core insight, novelty analysis, feasibility). Also auto-creates a StorySpine. Use when a promising direction emerges during exploration.

- **derive**: Create a new idea that combines or evolves from existing ideas. Like create, but requires derived_from (array of parent idea IDs). Also auto-creates a StorySpine. Use when synthesizing insights from multiple earlier candidates.

- **update**: Transition an idea to any valid status. Use for transitions not covered by the semantic shortcuts below (e.g. proposed → exploring, exploring → grounding). Records who decided and why.

- **select**: Mark an idea as the chosen research direction. Records selected_by and selected_date. Also updates the StorySpine status to "confirmed". This is a significant decision — it signals the project is ready to move from exploration toward method design.

- **park**: Shelve an idea for later. The idea is not rejected — it may become relevant again if the current direction fails or if new evidence appears. Also updates the StorySpine status to "archived". Use when an idea has potential but is not the priority.

- **reject**: Permanently reject an idea. Rejected ideas stay in the record for provenance and may be referenced by derived ideas. Also updates the StorySpine status to "rejected". Use when an idea is confirmed to be unviable or redundant.

- **review**: Record a structured review on an idea. Reviews are append-only and do not change the idea's status — the main agent or user decides status transitions after reading reviews. Reviewer subagents call this directly. Supports verdict (pass/revise/rethink), scores, action items, and full markdown output.

- **update_story**: Update the StorySpine for an idea. Fields: field_assumption, pain_point, non_obvious_insight, why_now, what_changes_if_true, candidate_paper_angles, story_risks, scores.

- **list**: List ideas with optional filters by status or exploration round. Only reads .yaml metadata — for full content (core insight, novelty analysis, feasibility), read the .md file at the path shown in md_path.

## Status lifecycle

\`\`\`
proposed → exploring → grounding → selected
                  ↘           ↘
                  parked ← → parked
                  ↘           ↘
                  rejected    rejected
\`\`\`

- proposed: just registered, not yet explored
- exploring: actively being researched and evaluated
- grounding: doing novelty / closest-work / gap alignment
- selected: confirmed as the current main direction
- parked: shelved but preserved for future revival
- rejected: confirmed unviable

## Key rules

- Never delete ideas. Rejected and parked ideas stay in the record.
- Only .yaml is managed by this tool. The .md file is for free editing.
- Use derive when an idea synthesizes earlier candidates.
- Reviews don't change status — they inform the decision.
- StorySpine is auto-created on create/derive and auto-updated on select/park/reject.

Typical flow: create → edit .md → update(exploring) → update(grounding) → review → select → research_plan(create)

Content and Notes:
- Pass content="## Core Insight\n\n..." on create/derive to write initial analysis (replaces empty template).
- Pass notes="..." on select/park/reject/update to append timestamped analysis to the .md (append-only).
- .md files are append-only research trail — never delete previous content.

Files: .research/ideas/ (idea_XXX.yaml + idea_XXX.md + idea_XXX.reviews.jsonl) and .research/positioning/ (story_XXX.story.yaml)`;

const IDEA_TRANSITIONS: Record<string, string[]> = {
  proposed: ["exploring", "parked", "rejected"],
  exploring: ["grounding", "parked", "rejected"],
  grounding: ["selected", "parked", "rejected"],
  selected: ["parked"],
  parked: [],
  rejected: [],
};

async function readIdea(id: string): Promise<IdeaYaml | undefined> {
  return ResearchFS.readYaml<IdeaYaml>(ResearchFS.resolve("ideas", `${id}.yaml`));
}

async function writeIdea(id: string, yaml: IdeaYaml): Promise<void> {
  await ResearchFS.writeYaml(ResearchFS.resolve("ideas", `${id}.yaml`), yaml);
}

async function transitionStatus(
  id: string,
  toStatus: IdeaYaml["status"],
  opts: { decided_by?: string; reason?: string; selected?: boolean; bypassValidation?: boolean } = {},
): Promise<ReturnType<typeof notFound> | { title: string; output: string; metadata: Record<string, any> }> {
  const yaml = await readIdea(id);
  if (!yaml) return notFound("Idea", id);

  const prevStatus = yaml.status;

  if (toStatus === prevStatus) {
    return {
      title: `${id} unchanged`,
      output: `${id} already has status "${prevStatus}".`,
      metadata: mdMeta({ id, status: prevStatus }),
    };
  }

  if (!opts.bypassValidation) {
    const allowed = IDEA_TRANSITIONS[prevStatus];
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
  }

  yaml.status = toStatus;

  if (opts.selected) {
    yaml.selected_by = opts.decided_by;
    yaml.selected_date = new Date().toISOString();
  }

  await writeIdea(id, yaml);

  await ResearchTimeline.append({
    type: "idea.status",
    id,
    from: prevStatus,
    to: toStatus,
    by: opts.decided_by,
    summary: opts.reason ?? `${id} status: ${prevStatus} → ${toStatus}`,
  });

  return {
    title: `${id} → ${toStatus}`,
    output: [
      `✅ ${id}: ${prevStatus} → ${toStatus}`,
      ...(opts.decided_by ? [`Decided by: ${opts.decided_by}`] : []),
      ...(opts.reason ? [`Reason: ${opts.reason}`] : []),
    ].join("\n"),
    metadata: mdMeta({ id, status: toStatus, previous_status: prevStatus }),
  };
}

export const researchIdea = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["create", "derive", "update", "select", "park", "reject", "review", "update_story", "list"])
      .describe("Semantic action to perform"),
    id: z
      .string()
      .optional()
      .describe("Idea ID (e.g. 'idea_003'). Required for update/select/park/reject/review/update_story."),
    title: z.string().optional().describe("Idea title. Required for create/derive."),
    status: IdeaStatus.optional().describe("Target status. Required for update."),
    round: z.number().optional().describe("Exploration round number. For create/derive. Default: 1."),
    derived_from: z
      .array(z.string())
      .optional()
      .describe("Parent idea IDs (e.g. ['idea_002', 'idea_005']). Required for derive, optional for create."),
    decided_by: z
      .string()
      .optional()
      .describe("Who made the decision (e.g. 'user', 'agent'). For update/select/reject."),
    reason: z.string().optional().describe("Reason for the action. For update/select/park/reject."),
    reviewer: z
      .enum(["inspector", "auditor", "critic", "editor"])
      .optional()
      .describe("Reviewer role performing the review"),
    summary: z.string().optional().describe("Review summary. Required for review."),
    focus: z.string().optional().describe("What aspect was reviewed (e.g. 'novelty and feasibility'). For review."),
    verdict: ReviewVerdict.optional().describe("Review verdict: pass, revise, or rethink. For review."),
    action_items: z.array(z.string()).optional().describe("Actionable follow-ups from review. For review."),
    scores: z
      .record(z.string(), z.number())
      .optional()
      .describe("Numeric scores (e.g. {novelty: 7, feasibility: 8}). For review and update_story."),
    review_body: z
      .string()
      .optional()
      .describe(
        "Reviewer's full markdown feedback. ONLY for review action. Saved as a separate .review.NNN.md file (not the entity's main .md).",
      ),
    content: z
      .string()
      .optional()
      .describe(
        "Initial .md content for create/derive. Write ## Core Insight, ## Novelty Analysis, ## Feasibility sections. Replaces empty template.",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Append to .md on select/park/reject/update. Explain WHY this decision was made. Auto-timestamped, append-only.",
      ),
    filter_status: IdeaStatus.optional().describe("Filter by status. For list."),
    force: z
      .boolean()
      .optional()
      .describe("Set to true to allow status changes via update action. Prefer semantic actions instead."),
    filter_round: z.number().optional().describe("Filter by round. For list."),
    field_assumption: z.string().optional().describe("StorySpine field. For update_story."),
    pain_point: z.string().optional().describe("StorySpine field. For update_story."),
    non_obvious_insight: z.string().optional().describe("StorySpine field. For update_story."),
    why_now: z.string().optional().describe("StorySpine field. For update_story."),
    what_changes_if_true: z.string().optional().describe("StorySpine field. For update_story."),
    candidate_paper_angles: z
      .array(
        z.object({
          type: z.enum([
            "new_method",
            "new_problem",
            "new_analysis",
            "method_transfer",
            "empirical_finding",
            "benchmark",
          ]),
          title_sketch: z.string(),
          promise: z.string(),
        }),
      )
      .optional()
      .describe("StorySpine field. For update_story."),
    story_risks: z.array(z.string()).optional().describe("StorySpine field. For update_story."),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(ideaMutex, async () => {
        if (!(await ResearchFS.isInitialized())) return notInitialized();
        const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
        const activePhaseRun = state?.focus?.active_phase_run;

        if (params.action === "create" || params.action === "derive") {
          if (!params.title) return missingParam("title", "Please provide a title for the idea.");

          if (params.action === "derive") {
            if (!params.derived_from?.length)
              return missingParam("derived_from", "derive requires derived_from (array of parent idea IDs).");

            for (const parentId of params.derived_from) {
              const parent = await readIdea(parentId);
              if (!parent) return notFound("Idea", parentId);
            }
          }

          const id = await ResearchId.next("idea");
          const now = new Date().toISOString();

          const yaml: IdeaYaml = {
            id,
            title: params.title,
            status: "proposed",
            round: params.round ?? 1,
            derived_from: params.derived_from,
            created: now,
            plan_refs: [],
          };
          await writeIdea(id, yaml);

          try {
            const md =
              params.content ??
              [
                `## Core Insight`,
                "",
                "(describe the key insight here)",
                "",
                `## Novelty Analysis`,
                "",
                "(what makes this different from existing work?)",
                "",
                `## Feasibility`,
                "",
                "(GPU hours, data requirements, main risks)",
                "",
              ].join("\n");
            await ResearchFS.writeMd(ResearchFS.resolve("ideas", `${id}.md`), md);

            const storyFields = parseStoryFields(params.content);
            const story = await StoryManager.create({
              idea_ref: id,
              field_assumption: storyFields.field_assumption,
              pain_point: storyFields.pain_point,
              non_obvious_insight: storyFields.non_obvious_insight,
              why_now: storyFields.why_now,
              what_changes_if_true: storyFields.what_changes_if_true,
            });

            yaml.story_ref = story.id;
            await writeIdea(id, yaml);

            await ResearchTimeline.append({
              type: "idea.created",
              id,
              title: params.title,
              summary: params.title,
              refs: params.derived_from,
            });

            await ResearchJournal.appendAgentNote({
              kind: "idea_rationale",
              refs: [id, story.id, ...(params.derived_from ?? [])],
              summary: `Idea created: ${params.title}`,
              note: params.content
                ? `Initial content and StorySpine (${story.id}) created for ${id}.`
                : `Idea ${id} registered as proposed with StorySpine (${story.id}). Fill the .md with core insight, novelty analysis, and feasibility.`,
            });

            // Update phase run inner loop for explore phase
            await updateActivePhaseRun(
              "explore",
              {
                incrementAttempts: true,
                summary: `Created ${id}: ${params.title}`,
              },
              activePhaseRun,
            );

            return {
              title: `Idea created: ${id}`,
              output: [
                `✅ Created ${id}: ${params.title}`,
                "",
                `Files:`,
                `  .research/ideas/${id}.yaml (metadata — managed by tool)`,
                `  .research/ideas/${id}.md (${params.content ? "content written" : "template — fill with core insight, novelty, feasibility"})`,
                `  .research/positioning/${story.id}.story.yaml (StorySpine — auto-created)`,
                "",
                `Status: proposed | Round: ${yaml.round}`,
                ...(params.derived_from?.length ? [`Derived from: ${params.derived_from.join(", ")}`] : []),
              ].join("\n"),
              metadata: mdMeta({ id, story_ref: story.id, path: `.research/ideas/${id}` }),
            };
          } catch (err) {
            log.error("IdeaCreate", "Partial creation - some steps failed", err);
            return {
              title: `Idea created (partial): ${id}`,
              output: [
                `⚠️ Created ${id} but some steps failed: ${err instanceof Error ? err.message : String(err)}`,
                `  Files: .research/ideas/${id}.yaml`,
                `  The .md, StorySpine, or timeline may be missing — retry or create manually.`,
              ].join("\n"),
              metadata: mdMeta({ id, partial: true }),
            };
          }
        }

        if (params.action === "update") {
          if (!params.id) return missingParam("id", 'Please provide the idea ID (e.g. "idea_003").');
          if (!params.status) return missingParam("status", "Please provide the target status for update.");

          if (params.status && params.force !== true) {
            return {
              title: "Status change requires force=true",
              output: `Status changes via update require force=true. Prefer semantic actions (select, reject, park) for lifecycle transitions. Use force=true only when you have explicit justification to bypass transition validation.`,
              metadata: mdMeta({ error: "force_required", id: params.id, target_status: params.status }),
            };
          }

          const existing = await readIdea(params.id);
          if (existing && existing.status !== params.status) {
            log.warn(
              "Transition",
              `Bypassing transition validation via update action: ${existing.status} → ${params.status}`,
            );
          }

          // audit#2 P0-1: when bypassing validation, do NOT mark `selected`
          // provenance (selected_by, selected_date). A force-override should
          // not produce an idea indistinguishable from one that went through
          // the proper select action. The status flips, but provenance does not.
          const result = await transitionStatus(params.id, params.status, {
            decided_by: params.decided_by,
            reason: params.reason,
            selected: false,
            bypassValidation: true,
          });
          if (existing && params.status !== existing.status) {
            await ResearchTimeline.append({
              type: "entity.status_override",
              phase: "explore",
              summary: `${params.id} status overridden: ${existing.status} → ${params.status}`,
              id: params.id,
            });
            await ResearchJournal.appendAgentNote({
              phase: "explore",
              kind: "status_override",
              refs: [params.id],
              summary: `${params.id} status overridden via update: ${existing.status} → ${params.status}`,
              note: `Transition validation was bypassed via the update action.`,
              importance: "critical",
            });
            if (isTerminalTransition(existing.status, params.status, IDEA_TRANSITIONS)) {
              log.warn(
                "TerminalOverride",
                `CRITICAL: ${params.id} leaving terminal state "${existing.status}" → "${params.status}"`,
              );
              await ResearchJournal.appendAgentNote({
                phase: "explore",
                kind: "status_override",
                refs: [params.id],
                summary: `CRITICAL: ${params.id} leaving terminal state "${existing.status}" → "${params.status}"`,
                note: `Entity was in terminal state "${existing.status}" (no valid outgoing transitions) and has been moved to "${params.status}" via the update action. This should only happen with explicit justification.`,
                importance: "critical",
              });
            }
          }
          if (params.notes) await appendNotes("ideas", params.id, "Update", params.notes);
          if (params.decided_by === "user" && params.reason) {
            await ResearchJournal.appendHumanDecision({
              kind: "decision_rationale",
              refs: [params.id],
              summary: `Idea ${params.id} updated to ${params.status}`,
              note: params.reason,
            });
          }
          return result;
        }

        if (params.action === "select") {
          if (!params.id) return missingParam("id", 'Please provide the idea ID to select (e.g. "idea_003").');
          const result = await transitionStatus(params.id, "selected", {
            decided_by: params.decided_by,
            reason: params.reason,
            selected: true,
          });
          if (params.notes) await appendNotes("ideas", params.id, "Select", params.notes);
          if (params.decided_by === "user" && params.reason) {
            await ResearchJournal.appendHumanDecision({
              kind: "decision_rationale",
              refs: [params.id],
              summary: `Idea ${params.id} selected`,
              note: params.reason,
            });
          }

          await updateActivePhaseRun(
            "explore",
            {
              state: "evaluate",
              summary: `Selected ${params.id} as research direction`,
            },
            activePhaseRun,
          );

          const idea = await readIdea(params.id);
          if (idea?.story_ref) {
            const story = await StoryManager.transition(idea.story_ref, "confirmed");
            if (story) {
              await ResearchJournal.appendAgentNote({
                kind: "decision_rationale",
                refs: [params.id, story.id],
                summary: `StorySpine ${story.id} confirmed`,
                note: `StorySpine for ${params.id} transitioned to confirmed as idea was selected.`,
              });
              return {
                ...result,
                metadata: { ...result.metadata, story_ref: story.id },
              };
            }
          }
          return result;
        }

        if (params.action === "park") {
          if (!params.id) return missingParam("id", 'Please provide the idea ID to park (e.g. "idea_003").');
          const result = await transitionStatus(params.id, "parked", {
            decided_by: params.decided_by,
            reason: params.reason,
          });
          if (params.notes) await appendNotes("ideas", params.id, "Park", params.notes);
          await ResearchJournal.appendAgentNote({
            kind: "decision_rationale",
            refs: [params.id],
            summary: `Idea ${params.id} parked`,
            note:
              params.reason ??
              `${params.id} shelved for later. May be revived if current direction fails or new evidence appears.`,
          });

          const idea = await readIdea(params.id);
          if (idea?.story_ref) {
            const story = await StoryManager.transition(idea.story_ref, "archived");
            if (story) {
              await ResearchJournal.appendAgentNote({
                kind: "decision_rationale",
                refs: [params.id, story.id],
                summary: `StorySpine ${story.id} archived`,
                note: `StorySpine for ${params.id} transitioned to archived as idea was parked.`,
              });
              return {
                ...result,
                metadata: { ...result.metadata, story_ref: story.id },
              };
            }
          }
          return result;
        }

        if (params.action === "reject") {
          if (!params.id) return missingParam("id", 'Please provide the idea ID to reject (e.g. "idea_003").');
          const result = await transitionStatus(params.id, "rejected", {
            decided_by: params.decided_by,
            reason: params.reason,
          });
          if (params.notes) await appendNotes("ideas", params.id, "Reject", params.notes);
          await ResearchJournal.appendAgentNote({
            kind: "decision_rationale",
            refs: [params.id],
            summary: `Idea ${params.id} rejected`,
            note: params.reason ?? `${params.id} permanently rejected.`,
          });

          const idea = await readIdea(params.id);
          if (idea?.story_ref) {
            const story = await StoryManager.transition(idea.story_ref, "rejected");
            if (story) {
              await ResearchJournal.appendAgentNote({
                kind: "decision_rationale",
                refs: [params.id, story.id],
                summary: `StorySpine ${story.id} rejected`,
                note: `StorySpine for ${params.id} transitioned to rejected as idea was rejected.`,
              });
              return {
                ...result,
                metadata: { ...result.metadata, story_ref: story.id },
              };
            }
          }
          return result;
        }

        if (params.action === "review") {
          if (!params.id) return missingParam("id", 'Please provide the idea ID to review (e.g. "idea_003").');
          if (!params.reviewer) return missingParam("reviewer", "Please provide the reviewer identity.");
          if (!params.summary) return missingParam("summary", "Please provide a review summary.");

          const yaml = await readIdea(params.id);
          if (!yaml) return notFound("Idea", params.id);

          const { round, review_file } = await ResearchReview.addReview("ideas", params.id, {
            reviewer: params.reviewer,
            focus: params.focus,
            verdict: params.verdict,
            summary: params.summary,
            action_items: params.action_items,
            scores: params.scores,
            review_body: params.review_body,
          });

          await ResearchTimeline.append({
            type: "idea.reviewed",
            id: params.id,
            summary: `Review round ${round} by ${params.reviewer}: ${params.verdict ?? "no verdict"} — ${params.summary}`,
          });

          await updateActivePhaseRun(
            "explore",
            {
              state: params.verdict === "pass" ? ("decide" as const) : ("evaluate" as const),
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

        if (params.action === "update_story") {
          if (!params.id) return missingParam("id", 'Please provide the idea ID (e.g. "idea_003").');

          const idea = await readIdea(params.id);
          if (!idea) return notFound("Idea", params.id);
          if (!idea.story_ref) return notFound("StorySpine", `No story_ref linked to ${params.id}`);

          const patch: Record<string, unknown> = {};
          if (params.field_assumption !== undefined) patch.field_assumption = params.field_assumption;
          if (params.pain_point !== undefined) patch.pain_point = params.pain_point;
          if (params.non_obvious_insight !== undefined) patch.non_obvious_insight = params.non_obvious_insight;
          if (params.why_now !== undefined) patch.why_now = params.why_now;
          if (params.what_changes_if_true !== undefined) patch.what_changes_if_true = params.what_changes_if_true;
          if (params.candidate_paper_angles !== undefined) patch.candidate_paper_angles = params.candidate_paper_angles;
          if (params.story_risks !== undefined) patch.story_risks = params.story_risks;
          if (params.scores !== undefined) patch.scores = params.scores;

          const story = await StoryManager.update(idea.story_ref, patch);
          if (!story) return notFound("StorySpine", idea.story_ref);

          await ResearchJournal.appendAgentNote({
            kind: "design_note",
            refs: [params.id, story.id],
            summary: `StorySpine ${story.id} updated`,
            note: `StorySpine for ${params.id} updated. Fields: ${Object.keys(patch).join(", ")}.`,
          });

          return {
            title: `StorySpine updated: ${story.id}`,
            output: [
              `✅ StorySpine ${story.id} updated for ${params.id}`,
              `Fields updated: ${Object.keys(patch).join(", ")}`,
              `Version: ${story.version}`,
            ].join("\n"),
            metadata: mdMeta({ id: params.id, story_ref: story.id, version: story.version }),
          };
        }

        if (params.action === "list") {
          const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("ideas"));
          const ideas: IdeaYaml[] = [];

          for (const file of yamlFiles) {
            const yaml = await ResearchFS.readYaml<IdeaYaml>(ResearchFS.resolve("ideas", file));
            if (yaml) ideas.push(yaml);
          }

          let filtered = ideas;
          if (params.filter_status) filtered = filtered.filter((i) => i.status === params.filter_status);
          if (params.filter_round !== undefined) filtered = filtered.filter((i) => i.round === params.filter_round);

          if (filtered.length === 0) {
            return {
              title: "Ideas",
              output: "No ideas found.",
              metadata: mdMeta({ count: 0 }),
            };
          }

          const lines = [`=== Ideas (${filtered.length}) ===`, ""];

          for (const idea of filtered) {
            const derived = idea.derived_from?.length ? ` ← ${idea.derived_from.join(", ")}` : "";
            lines.push(
              `${idea.id}  [${idea.status}]  ${idea.title} (round ${idea.round})${derived}  → ${entityMdPath(idea.id)}`,
            );
          }

          return {
            title: "Ideas",
            output: lines.join("\n"),
            metadata: mdMeta({
              count: filtered.length,
              ideas: filtered.map((i) => ({ id: i.id, title: i.title, status: i.status, md_path: entityMdPath(i.id) })),
            }),
          };
        } // end list action
        else {
          return {
            title: "Unknown action",
            output: `Unknown action "${params.action}". Valid actions are: create, derive, update, select, park, reject, review, update_story, list.`,
            metadata: mdMeta({ error: "unknown_action" }),
          };
        }
      });
    });
  },
});
