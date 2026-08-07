import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { ResearchId } from "../id";
import { ResearchJournal } from "../journal";
import { withLock } from "../lock";
import { log } from "../log";
import { updateActivePhaseRun } from "../phase-run";
import { ResearchReview } from "../review";
import type { IdeaYaml, PlanYaml, StateYaml } from "../schema";
import { KillCriterion, PlanStatus, ReviewVerdict, SufficientCriterion } from "../schema";
import { ResearchTimeline } from "../timeline";
import {
  appendNotes,
  entityMdPath,
  isTerminalTransition,
  lineageWarning,
  mdMeta,
  notFound,
  notInitialized,
  planMutex,
  withGuard,
} from "./shared";

const PLAN_TRANSITIONS: Record<string, string[]> = {
  draft: ["refining", "cancelled"],
  refining: ["approved", "cancelled"],
  approved: ["active", "cancelled"],
  active: ["superseded", "cancelled"],
  superseded: [],
  cancelled: [],
};

const DESCRIPTION = `Manage experiment plans — structured proposals for what experiments to run, how, and why.

Plans are the bridge between a selected idea and actual experiments. They version through supersession: rather than editing a plan in place, create a new plan with supersedes pointing to the old one. Only one plan can be active at a time — activating a new plan automatically supersedes the previous active plan.

Lifecycle: draft → refining → approved → active → superseded/cancelled

9 actions:
- action="create": Register a new plan. ID is auto-assigned (e.g. plan_002). Creates .yaml + .md template. Starts as "draft".
- action="refine": Move a draft plan to "refining" status — signals the plan is being iterated on.
- action="approve": Mark a plan as "approved" — ready to be activated. Records who approved and when.
- action="activate": Make this the active plan. Any currently active plan is auto-superseded. Only one plan can be active.
- action="supersede": Explicitly supersede a plan (e.g. when replaced by a new version).
- action="cancel": Cancel a plan that won't be pursued. Optional reason.
- action="review": Record a structured review on a plan. Supports verdict (pass/revise/rethink), scores, and raw markdown. Reviews are appended — never overwritten.
- action="list": List plans with optional filters by status. Only reads .yaml metadata — for full content (method specification, review history), read the .md file at the path shown in md_path.
- action="update": Generic status transition for cases not covered by the semantic actions above.

Use this to:
- Draft an experiment plan for a selected idea (create with idea reference)
- Iterate on plan content with reviewers (refine, review)
- Get user approval before proceeding (approve with approved_by)
- Activate the plan to signal experiments can begin (activate)
- Replace a plan with a new version (create with supersedes, then activate the new one)

Typical flow: research_idea(action="select") → research_plan(action="create", idea="idea_014") → edit .md → research_plan(review, ...) → research_plan(approve) → research_plan(activate) → research_experiment(create, plan="plan_002")

Content and Notes:
- Pass content="## Overview\n\n..." on create to write the full plan (replaces empty template).
- Pass notes="..." on activate/supersede/cancel to append timestamped context to the .md (append-only).
- .md files are append-only research trail — never delete previous content.

Files: .research/plans/ (plan_XXX.yaml + plan_XXX.md + plan_XXX.reviews.jsonl)`;

async function loadPlan(id: string): Promise<{ yaml: PlanYaml; path: string } | undefined> {
  const yamlPath = ResearchFS.resolve("plans", `${id}.yaml`);
  const yaml = await ResearchFS.readYaml<PlanYaml>(yamlPath);
  if (!yaml) return undefined;
  return { yaml, path: yamlPath };
}

async function autoSupersedeCurrent(excludeId: string): Promise<string[]> {
  // Caller must already hold planMutex — no nested lock needed
  const supersededIds: string[] = [];
  const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("plans"));
  for (const file of yamlFiles) {
    const otherPath = ResearchFS.resolve("plans", file);
    const other = await ResearchFS.readYaml<PlanYaml>(otherPath);
    if (other && other.id !== excludeId && other.status === "active") {
      other.status = "superseded";
      await ResearchFS.writeYaml(otherPath, other);
      await ResearchTimeline.append({
        type: "plan.status",
        id: other.id,
        from: "active",
        to: "superseded",
        summary: `Auto-superseded by ${excludeId}`,
      });
      supersededIds.push(other.id);
    }
  }
  return supersededIds;
}

function validatePlanTransition(from: string, to: string): string | null {
  const allowed = PLAN_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    return `Cannot transition from "${from}" to "${to}". Allowed: ${(allowed ?? []).join(", ") || "none"}`;
  }
  return null;
}

export const researchPlan = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["create", "refine", "approve", "activate", "supersede", "cancel", "review", "list", "update"])
      .describe("Operation to perform"),
    id: z.string().optional().describe("Plan ID, e.g. 'plan_002'. Required for all actions except create and list."),
    title: z.string().optional().describe("Plan title. Required for create."),
    idea_ref: z.string().optional().describe("Idea ID this plan is based on, e.g. 'idea_014'. For create."),
    supersedes: z
      .string()
      .optional()
      .describe("Previous plan ID this replaces, e.g. 'plan_001'. For create when versioning."),
    approved_by: z.string().optional().describe("Who approved this plan, e.g. 'user'. For approve."),
    status: PlanStatus.optional().describe("Target status. Required for update action."),
    reason: z.string().optional().describe("Reason for status change. For cancel and update."),
    filter_status: PlanStatus.optional().describe("Only show plans with this status. For list."),
    reviewer: z
      .enum(["inspector", "auditor", "critic", "editor"])
      .optional()
      .describe("Reviewer role performing the review"),
    summary: z.string().optional().describe("Review summary. Required for review."),
    focus: z.string().optional().describe("What the review focused on. For review."),
    verdict: ReviewVerdict.optional().describe("Review verdict: pass, revise, or rethink. For review."),
    action_items: z.array(z.string()).optional().describe("Action items from the review. For review."),
    scores: z
      .record(z.string(), z.number())
      .optional()
      .describe("Numeric scores, e.g. {feasibility: 4, novelty: 3}. For review."),
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
        "Initial .md content for create. Write ## Overview, ## Experiments, ## Success Criteria sections. Replaces empty template.",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Append to .md on activate/supersede/cancel. Record context for this transition. Auto-timestamped, append-only.",
      ),
    kill_set: z
      .array(KillCriterion)
      .optional()
      .describe("Kill criteria — minimum bar experiments must clear. For create or update."),
    sufficient_set: z
      .array(SufficientCriterion)
      .optional()
      .describe("Sufficient criteria — what would validate the plan. For create or update."),
    force: z
      .boolean()
      .optional()
      .describe("Set to true to allow status changes via update action. Prefer semantic actions instead."),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(planMutex, async () => {
        if (!(await ResearchFS.isInitialized())) return notInitialized();
        const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
        const activePhaseRun = state?.focus?.active_phase_run;

        if (params.action === "create") {
          if (!params.title) {
            return {
              title: "Missing title",
              output: "Please provide a title for the plan.",
              metadata: mdMeta({ error: "missing_title" }),
            };
          }

          const id = await ResearchId.next("plan");
          const now = new Date().toISOString();

          const yaml: PlanYaml = {
            id,
            title: params.title,
            status: "draft",
            idea_ref: params.idea_ref,
            supersedes: params.supersedes,
            created: now,
            kill_set: params.kill_set ?? [],
            sufficient_set: params.sufficient_set ?? [],
            experiment_refs: [],
            code_artifact_refs: [],
            rqg_refs: [],
            diagnosis_refs: [],
          };
          await ResearchFS.writeYaml(ResearchFS.resolve("plans", `${id}.yaml`), yaml);

          const md =
            params.content ??
            [
              `## Overview`,
              "",
              "(describe the experiment plan here)",
              "",
              `## Experiments`,
              "",
              "(list experiments to run)",
              "",
              `## Success Criteria`,
              "",
              "(what would validate this plan?)",
              "",
            ].join("\n");
          await ResearchFS.writeMd(ResearchFS.resolve("plans", `${id}.md`), md);

          await ResearchTimeline.append({
            type: "plan.created",
            id,
            title: params.title,
            summary: params.title,
            refs: params.idea_ref ? [params.idea_ref] : undefined,
          });

          await ResearchJournal.appendAgentNote({
            kind: "design_note",
            refs: [id, ...(params.idea_ref ? [params.idea_ref] : [])],
            summary: `Plan created: ${params.title}`,
            note: params.content
              ? `Initial plan content written for ${id}.`
              : `Plan ${id} registered as draft. Fill the .md with overview, experiments, and success criteria.`,
          });

          // Update phase run inner loop (attempt count + summary)
          await updateActivePhaseRun(
            "design",
            { incrementAttempts: true, summary: `Created ${id}: ${params.title}` },
            activePhaseRun,
          );

          // ── Back-link: update idea.plan_refs and propagate story_ref ──
          let backLinkWarning: string | undefined;
          if (params.idea_ref) {
            try {
              const idea = await ResearchFS.readYaml<IdeaYaml>(ResearchFS.resolve("ideas", `${params.idea_ref}.yaml`));
              if (idea) {
                if (!idea.plan_refs) idea.plan_refs = [];
                if (!idea.plan_refs.includes(id)) {
                  idea.plan_refs.push(id);
                  await ResearchFS.writeYaml(ResearchFS.resolve("ideas", `${params.idea_ref}.yaml`), idea);
                }
                // Propagate story_ref from idea to plan
                if (idea.story_ref && !yaml.story_ref) {
                  yaml.story_ref = idea.story_ref;
                  await ResearchFS.writeYaml(ResearchFS.resolve("plans", `${id}.yaml`), yaml);
                }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log.warn("BackLink", "Failed to update idea.plan_refs:", msg);
              backLinkWarning = `⚠️ Back-link failed: idea ${params.idea_ref}.plan_refs not updated (${msg})`;
            }
          }

          return {
            title: `Plan created: ${id}`,
            output:
              [
                `✅ Created ${id}: ${params.title}`,
                "",
                `Files:`,
                `  .research/plans/${id}.yaml (metadata)`,
                `  .research/plans/${id}.md (${params.content ? "content written" : "template — fill with overview, experiments, success criteria"})`,
                "",
                `Status: draft`,
                ...(params.idea_ref ? [`Idea: ${params.idea_ref}`] : []),
                ...(params.supersedes ? [`Supersedes: ${params.supersedes}`] : []),
                ...(backLinkWarning ? ["", backLinkWarning] : []),
              ].join("\n") + lineageWarning("plan", params),
            metadata: mdMeta({ id, path: `.research/plans/${id}` }),
          };
        }

        if (params.action === "refine") {
          if (!params.id) {
            return {
              title: "Missing ID",
              output: "Please provide the plan ID.",
              metadata: mdMeta({ error: "missing_id" }),
            };
          }
          const loaded = await loadPlan(params.id);
          if (!loaded) return notFound("Plan", params.id);

          if (loaded.yaml.status !== "draft") {
            return {
              title: "Invalid transition",
              output: `Cannot refine ${params.id} — current status is "${loaded.yaml.status}", expected "draft".`,
              metadata: mdMeta({ error: "invalid_transition", current: loaded.yaml.status }),
            };
          }

          loaded.yaml.status = "refining";
          await ResearchFS.writeYaml(loaded.path, loaded.yaml);

          await ResearchTimeline.append({
            type: "plan.status",
            id: params.id,
            from: "draft",
            to: "refining",
            summary: `${params.id} status: draft → refining`,
          });

          return {
            title: `${params.id} → refining`,
            output: `✅ ${params.id} is now in refining stage.`,
            metadata: mdMeta({ id: params.id, status: "refining" }),
          };
        }

        if (params.action === "approve") {
          if (!params.id) {
            return {
              title: "Missing ID",
              output: "Please provide the plan ID.",
              metadata: mdMeta({ error: "missing_id" }),
            };
          }
          const loaded = await loadPlan(params.id);
          if (!loaded) return notFound("Plan", params.id);

          const transitionError = validatePlanTransition(loaded.yaml.status, "approved");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: loaded.yaml.status,
                target: "approved",
              }),
            };
          }

          const prev = loaded.yaml.status;
          loaded.yaml.status = "approved";
          loaded.yaml.approved_by = params.approved_by;
          loaded.yaml.approved_date = new Date().toISOString();
          await ResearchFS.writeYaml(loaded.path, loaded.yaml);

          await ResearchTimeline.append({
            type: "plan.status",
            id: params.id,
            from: prev,
            to: "approved",
            by: params.approved_by,
            summary: `${params.id} approved${params.approved_by ? ` by ${params.approved_by}` : ""}`,
          });

          await updateActivePhaseRun("design", { state: "decide", summary: `Approved ${params.id}` }, activePhaseRun);

          return {
            title: `${params.id} approved`,
            output: [
              `✅ ${params.id} is now approved.`,
              ...(params.approved_by ? [`Approved by: ${params.approved_by}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: "approved", approved_by: params.approved_by }),
          };
        }

        if (params.action === "activate") {
          if (!params.id) {
            return {
              title: "Missing ID",
              output: "Please provide the plan ID.",
              metadata: mdMeta({ error: "missing_id" }),
            };
          }
          const loaded = await loadPlan(params.id);
          if (!loaded) return notFound("Plan", params.id);

          const transitionError = validatePlanTransition(loaded.yaml.status, "active");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: loaded.yaml.status,
                target: "active",
              }),
            };
          }

          const prev = loaded.yaml.status;
          const supersededIds = await autoSupersedeCurrent(params.id);

          loaded.yaml.status = "active";
          await ResearchFS.writeYaml(loaded.path, loaded.yaml);

          await ResearchTimeline.append({
            type: "plan.status",
            id: params.id,
            from: prev,
            to: "active",
            summary: `${params.id} activated${supersededIds.length > 0 ? ` (superseded ${supersededIds.join(", ")})` : ""}`,
          });

          if (params.notes) await appendNotes("plans", params.id, "Activate", params.notes);
          await ResearchJournal.appendAgentNote({
            kind: "design_note",
            refs: [params.id, ...supersededIds],
            summary: `Plan ${params.id} activated`,
            note:
              params.notes ??
              `Plan ${params.id} is now the active plan.${supersededIds.length > 0 ? ` Auto-superseded ${supersededIds.join(", ")}.` : ""}`,
          });

          await updateActivePhaseRun("design", { state: "attempt", summary: `Activated ${params.id}` }, activePhaseRun);

          return {
            title: `${params.id} activated`,
            output: [
              `✅ ${params.id} is now the active plan.`,
              ...(supersededIds.length > 0 ? [`Auto-superseded: ${supersededIds.join(", ")}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: "active", superseded: supersededIds }),
          };
        }

        if (params.action === "supersede") {
          if (!params.id) {
            return {
              title: "Missing ID",
              output: "Please provide the plan ID.",
              metadata: mdMeta({ error: "missing_id" }),
            };
          }
          const loaded = await loadPlan(params.id);
          if (!loaded) return notFound("Plan", params.id);

          const transitionError = validatePlanTransition(loaded.yaml.status, "superseded");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: loaded.yaml.status,
                target: "superseded",
              }),
            };
          }

          const prev = loaded.yaml.status;
          loaded.yaml.status = "superseded";
          await ResearchFS.writeYaml(loaded.path, loaded.yaml);

          await ResearchTimeline.append({
            type: "plan.status",
            id: params.id,
            from: prev,
            to: "superseded",
            summary: `${params.id} superseded`,
          });

          if (params.notes) await appendNotes("plans", params.id, "Supersede", params.notes);

          return {
            title: `${params.id} superseded`,
            output: `✅ ${params.id} has been superseded.`,
            metadata: mdMeta({ id: params.id, status: "superseded" }),
          };
        }

        if (params.action === "cancel") {
          if (!params.id) {
            return {
              title: "Missing ID",
              output: "Please provide the plan ID.",
              metadata: mdMeta({ error: "missing_id" }),
            };
          }
          const loaded = await loadPlan(params.id);
          if (!loaded) return notFound("Plan", params.id);

          const transitionError = validatePlanTransition(loaded.yaml.status, "cancelled");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: loaded.yaml.status,
                target: "cancelled",
              }),
            };
          }

          const prev = loaded.yaml.status;
          loaded.yaml.status = "cancelled";
          await ResearchFS.writeYaml(loaded.path, loaded.yaml);

          await ResearchTimeline.append({
            type: "plan.status",
            id: params.id,
            from: prev,
            to: "cancelled",
            summary: params.reason ?? `${params.id} cancelled`,
          });

          if (params.notes) await appendNotes("plans", params.id, "Cancel", params.notes);
          await ResearchJournal.appendAgentNote({
            kind: "design_note",
            refs: [params.id],
            summary: `Plan ${params.id} cancelled`,
            note: params.reason ?? `Plan ${params.id} has been cancelled.`,
          });

          return {
            title: `${params.id} cancelled`,
            output: [
              `✅ ${params.id} has been cancelled.`,
              ...(params.reason ? [`Reason: ${params.reason}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: "cancelled" }),
          };
        }

        if (params.action === "review") {
          if (!params.id) {
            return {
              title: "Missing ID",
              output: "Please provide the plan ID.",
              metadata: mdMeta({ error: "missing_id" }),
            };
          }
          if (!params.reviewer || !params.summary) {
            return {
              title: "Missing fields",
              output: "Please provide both reviewer and summary for the review.",
              metadata: mdMeta({ error: "missing_review_fields" }),
            };
          }

          const loaded = await loadPlan(params.id);
          if (!loaded) return notFound("Plan", params.id);

          const { round, review_file } = await ResearchReview.addReview("plans", params.id, {
            reviewer: params.reviewer,
            focus: params.focus,
            verdict: params.verdict,
            summary: params.summary,
            action_items: params.action_items,
            scores: params.scores,
            review_body: params.review_body,
          });

          await ResearchTimeline.append({
            type: "plan.reviewed",
            id: params.id,
            by: params.reviewer,
            summary: `Review round ${round}: ${params.verdict ?? "no verdict"} — ${params.summary}`,
          });

          // Update phase run inner loop state based on review verdict
          // Update phase run inner loop (state + summary)
          const newState = params.verdict === "pass" ? ("decide" as const) : ("evaluate" as const);
          await updateActivePhaseRun(
            "design",
            {
              state: newState,
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

        if (params.action === "list") {
          const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("plans"));
          const plans: PlanYaml[] = [];

          for (const file of yamlFiles) {
            const yaml = await ResearchFS.readYaml<PlanYaml>(ResearchFS.resolve("plans", file));
            if (yaml) plans.push(yaml);
          }

          let filtered = plans;
          if (params.filter_status) filtered = filtered.filter((p) => p.status === params.filter_status);

          if (filtered.length === 0) {
            return {
              title: "Plans",
              output: "No plans found.",
              metadata: mdMeta({ count: 0 }),
            };
          }

          const lines = [`=== Plans (${filtered.length}) ===`, ""];

          for (const plan of filtered) {
            const ideaStr = plan.idea_ref ? ` ← ${plan.idea_ref}` : "";
            const supStr = plan.supersedes ? ` (supersedes ${plan.supersedes})` : "";
            lines.push(`${plan.id}  [${plan.status}]  ${plan.title}${ideaStr}${supStr}  → ${entityMdPath(plan.id)}`);
          }

          return {
            title: "Plans",
            output: lines.join("\n"),
            metadata: mdMeta({
              count: filtered.length,
              plans: filtered.map((p) => ({ id: p.id, title: p.title, status: p.status, md_path: entityMdPath(p.id) })),
            }),
          };
        }

        if (params.action === "update") {
          if (!params.id) {
            return {
              title: "Missing ID",
              output: "Please provide the plan ID.",
              metadata: mdMeta({ error: "missing_id" }),
            };
          }
          if (!params.status) {
            return {
              title: "Missing status",
              output: "Please provide the target status.",
              metadata: mdMeta({ error: "missing_status" }),
            };
          }

          if (params.status && params.force !== true) {
            return {
              title: "Status change requires force=true",
              output: `Status changes via update require force=true. Prefer semantic actions (refine, approve, activate, supersede, cancel) for lifecycle transitions. Use force=true only when you have explicit justification to bypass transition validation.`,
              metadata: mdMeta({ error: "force_required", id: params.id, target_status: params.status }),
            };
          }

          const loaded = await loadPlan(params.id);
          if (!loaded) return notFound("Plan", params.id);

          const prev = loaded.yaml.status;

          // Kill/Sufficient set immutability gate (audit#2 P0-5).
          // Once a plan is active (or past), its kill_set / sufficient_set define
          // the bar that experiments are judged against. Rewriting them post-hoc
          // violates R1 (Metric Immutability). Require the agent to supersede
          // the plan rather than rewrite criteria in place.
          const LOCKED_FOR_CRITERIA = new Set(["active", "superseded", "cancelled"]);
          const mutatingCriteria = params.kill_set !== undefined || params.sufficient_set !== undefined;
          if (mutatingCriteria && LOCKED_FOR_CRITERIA.has(prev)) {
            return {
              title: "Kill/Sufficient criteria are locked",
              output: [
                `❌ Cannot modify kill_set / sufficient_set on ${params.id}: plan is in status "${prev}".`,
                "",
                "Once a plan is active, its gating criteria are frozen — rewriting them after results come in",
                "violates R1 (Metric Immutability). To change criteria, supersede the plan with a new one:",
                `  research_plan(action="create", supersedes="${params.id}", ...)`,
                `  research_plan(action="activate", id="<new plan id>")`,
              ].join("\n"),
              metadata: mdMeta({
                id: params.id,
                error: "criteria_locked",
                current_status: prev,
                attempted: {
                  kill_set: params.kill_set !== undefined,
                  sufficient_set: params.sufficient_set !== undefined,
                },
              }),
            };
          }

          if (params.status !== prev) {
            log.warn("Transition", `Bypassing transition validation via update action: ${prev} → ${params.status}`);
          }
          loaded.yaml.status = params.status;
          if (params.kill_set !== undefined) loaded.yaml.kill_set = params.kill_set;
          if (params.sufficient_set !== undefined) loaded.yaml.sufficient_set = params.sufficient_set;
          await ResearchFS.writeYaml(loaded.path, loaded.yaml);

          if (params.status !== prev) {
            await ResearchTimeline.append({
              type: "plan.status",
              id: params.id,
              from: prev,
              to: params.status,
              summary: params.reason ?? `${params.id} status: ${prev} → ${params.status}`,
            });
            await ResearchTimeline.append({
              type: "entity.status_override",
              phase: "design",
              summary: `${params.id} status overridden: ${prev} → ${params.status}`,
              id: params.id,
            });
            await ResearchJournal.appendAgentNote({
              phase: "design",
              kind: "status_override",
              refs: [params.id],
              summary: `${params.id} status overridden via update: ${prev} → ${params.status}`,
              note: `Transition validation was bypassed via the update action.`,
              importance: "critical",
            });
            if (isTerminalTransition(prev, params.status, PLAN_TRANSITIONS)) {
              log.warn(
                "TerminalOverride",
                `CRITICAL: ${params.id} leaving terminal state "${prev}" → "${params.status}"`,
              );
              await ResearchJournal.appendAgentNote({
                phase: "design",
                kind: "status_override",
                refs: [params.id],
                summary: `CRITICAL: ${params.id} leaving terminal state "${prev}" → "${params.status}"`,
                note: `Entity was in terminal state "${prev}" (no valid outgoing transitions) and has been moved to "${params.status}" via the update action. This should only happen with explicit justification.`,
                importance: "critical",
              });
            }
          }

          if (params.kill_set !== undefined || params.sufficient_set !== undefined) {
            await ResearchJournal.appendAgentNote({
              kind: "design_note",
              refs: [params.id],
              summary: `Plan ${params.id} criteria updated`,
              note: [
                ...(params.kill_set !== undefined ? [`kill_set updated (${params.kill_set.length} criteria)`] : []),
                ...(params.sufficient_set !== undefined
                  ? [`sufficient_set updated (${params.sufficient_set.length} criteria)`]
                  : []),
              ].join("; "),
            });
          }

          return {
            title: `${params.id} updated`,
            output: [
              `✅ Updated ${params.id}`,
              "",
              `Status: ${loaded.yaml.status}`,
              ...(params.reason ? [`Reason: ${params.reason}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: loaded.yaml.status }),
          };
        }

        return {
          title: "Unknown action",
          output: `Unknown action "${params.action}". Use create, refine, approve, activate, supersede, cancel, review, list, or update.`,
          metadata: mdMeta({ error: "unknown_action" }),
        };
      });
    });
  },
});
