import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { ResearchId } from "../id";
import { ResearchJournal } from "../journal";
import { withLock } from "../lock";
import { log } from "../log";
import { updateActivePhaseRun } from "../phase-run";
import { ResearchReview } from "../review";
import type { StateYaml, SubmissionYaml } from "../schema";
import { ReviewVerdict, SubmissionStatus } from "../schema";
import { ResearchTimeline } from "../timeline";
import {
  appendNotes,
  entityMdPath,
  isTerminalTransition,
  mdMeta,
  missingParam,
  notFound,
  notInitialized,
  submissionMutex,
  withGuard,
} from "./shared";

const DESCRIPTION = `Manage the venue interaction lifecycle for research submissions — everything AFTER the paper is ready.

A submission tracks one attempt to get a paper accepted at a venue. Because the same paper may be submitted to multiple venues (sequentially or after revision), submission is decoupled from paper. Each submission carries its own status, review rounds, rebuttal history, and outcome.

## Status lifecycle

\`\`\`
preparing → submitted → under_review → rebuttal → revision_requested → resubmitted → under_review → ...
                                                                                   → accepted
                                                                                   → rejected
                                                     → accepted
                                                     → rejected
                       → accepted
                       → rejected
                       → closed (withdrawn)
\`\`\`

- **preparing**: gathering materials, formatting for venue requirements
- **submitted**: sent to venue, awaiting assignment/review
- **under_review**: reviews in progress at venue
- **rebuttal**: author response period (after reviews received)
- **revision_requested**: venue requested revisions (major or minor)
- **resubmitted**: revised version sent back to venue
- **accepted**: paper accepted at this venue
- **rejected**: paper rejected at this venue
- **closed**: withdrawn or otherwise terminated

## Actions

- **create**: Register a new submission with a title, optional paper ref and venue. Creates .yaml + .md template.
- **submit**: Mark as submitted to the venue. Records submitted_date and first round entry.
- **record_round**: Record a review round event (e.g. reviews received, meta-review posted). Appends to rounds array.
- **enter_rebuttal**: Transition to rebuttal phase after receiving reviews.
- **request_revision**: Record that the venue requested revisions. Appends round entry.
- **resubmit**: Mark the revised version as resubmitted. Appends round entry.
- **close**: Close the submission with an outcome (accepted, rejected, or closed/withdrawn).
- **review**: Record external reviewer comments using the shared review infrastructure. Use this for each reviewer's feedback.
- **list**: List submissions with optional status filter. Only reads .yaml metadata — for full content (rebuttal plan, predicted concerns, round notes), read the .md file at the path shown in md_path.
- **update**: Generic update for venue, paper ref, or status.

## How external reviews connect

When reviewer comments arrive, use action="review" to record each reviewer's feedback as a structured review entry. These are stored in .reviews.jsonl and .review.NNN.md files alongside the submission yaml. The review action does NOT change submission status — use record_round and enter_rebuttal for status transitions.

When revision is needed, the experiment/claim/compose tools handle the actual research work. This tool tracks the venue-side lifecycle only.

Typical flow: create → submit → record_round (reviews received) → review (per reviewer) → enter_rebuttal → request_revision → [revise in compose/experiment tools] → resubmit → close (accepted/rejected)

Content and Notes:
- Pass content="## Submission Notes\n\n..." on create to document venue prep (replaces empty template).
- Pass notes="..." on submit/close/enter_rebuttal/request_revision/resubmit to record round context (append-only).
- .md files are append-only research trail — never delete previous content.

Files: .research/submissions/ (sub_XXX.yaml + sub_XXX.md + sub_XXX.reviews.jsonl)`;

const SUBMISSION_TRANSITIONS: Record<string, string[]> = {
  preparing: ["submitted", "closed"],
  submitted: ["under_review", "closed"],
  under_review: ["rebuttal", "accepted", "rejected", "closed"],
  rebuttal: ["revision_requested", "accepted", "rejected", "closed"],
  revision_requested: ["resubmitted", "closed"],
  resubmitted: ["under_review", "closed"],
  accepted: [],
  rejected: [],
  closed: [],
};

function validateTransition(from: string, to: string): string | null {
  const allowed = SUBMISSION_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    return `Cannot transition from "${from}" to "${to}". Allowed: ${(allowed ?? []).join(", ") || "none"}`;
  }
  return null;
}

const SubmissionOutcome = z.enum(["accepted", "rejected", "closed"]);

async function readSubmission(id: string): Promise<SubmissionYaml | undefined> {
  return ResearchFS.readYaml<SubmissionYaml>(ResearchFS.resolve("submissions", `${id}.yaml`));
}

async function writeSubmission(id: string, yaml: SubmissionYaml): Promise<void> {
  await ResearchFS.writeYaml(ResearchFS.resolve("submissions", `${id}.yaml`), yaml);
}

async function appendStatusEvent(id: string, from: string, to: string, summary?: string): Promise<void> {
  await ResearchTimeline.append({
    type: "submission.status",
    id,
    from,
    to,
    summary: summary ?? `${id} status: ${from} → ${to}`,
  });
}

export const researchSubmission = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum([
        "create",
        "submit",
        "record_round",
        "enter_rebuttal",
        "request_revision",
        "resubmit",
        "close",
        "review",
        "list",
        "update",
      ])
      .describe("Action to perform on the submission"),
    id: z
      .string()
      .optional()
      .describe("Submission ID (e.g. 'sub_001'). Required for all actions except create and list."),
    title: z.string().optional().describe("Submission title. Required for create."),
    paper: z.string().optional().describe("Paper ID ref (e.g. 'paper_001'). For create/update."),
    venue: z.string().optional().describe("Target venue (e.g. 'ICML 2027'). For create/update."),
    submitted_date: z.string().optional().describe("Date submitted (ISO string). For submit action. Defaults to now."),
    round_status: z
      .string()
      .optional()
      .describe("Round event label (e.g. 'reviews_received', 'meta_review_posted'). For record_round."),
    outcome: SubmissionOutcome.optional().describe(
      "Final outcome: accepted, rejected, or closed (withdrawn). For close.",
    ),
    summary: z
      .string()
      .optional()
      .describe("Summary text for round entries, revision requests, resubmissions, or close."),
    status: SubmissionStatus.optional().describe("Target status. For update action only."),
    force: z
      .boolean()
      .optional()
      .describe("Required with update when changing status directly; records a status_override audit trail."),
    reviewer: z
      .enum(["inspector", "auditor", "critic", "editor"])
      .optional()
      .describe("Reviewer role performing the review"),
    focus: z.string().optional().describe("What aspect was reviewed (e.g. 'novelty', 'experiments'). For review."),
    verdict: ReviewVerdict.optional().describe("Review verdict: pass, revise, or rethink. For review."),
    action_items: z.array(z.string()).optional().describe("Actionable follow-ups from review. For review."),
    scores: z
      .record(z.string(), z.number())
      .optional()
      .describe("Numeric scores (e.g. {novelty: 6, clarity: 7, soundness: 5}). For review."),
    review_body: z
      .string()
      .optional()
      .describe(
        "Reviewer's full markdown feedback. ONLY for review action. Saved as a separate .review.NNN.md file (not the entity's main .md).",
      ),
    filter_status: SubmissionStatus.optional().describe("Filter by status. For list."),
    content: z
      .string()
      .optional()
      .describe(
        "Initial .md content for create. Write ## Submission Notes, ## Review Rounds, ## Rebuttal Plan. Replaces empty template.",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Append to .md on submit/close/enter_rebuttal/request_revision/resubmit. Record round context. Auto-timestamped, append-only.",
      ),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(submissionMutex, async () => {
        if (!(await ResearchFS.isInitialized())) return notInitialized();
        const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
        const activePhaseRun = state?.focus?.active_phase_run;

        if (params.action === "create") {
          if (!params.title) return missingParam("title", "Please provide a title for the submission.");

          const id = await ResearchId.next("sub");
          const now = new Date().toISOString();

          const yaml: SubmissionYaml = {
            id,
            title: params.title,
            status: "preparing",
            paper: params.paper,
            venue: params.venue,
            rounds: [],
            created: now,
          };
          await writeSubmission(id, yaml);

          const md =
            params.content ??
            [
              `## Submission Notes`,
              "",
              "(venue requirements, formatting notes, supplementary material plan)",
              "",
              `## Review Rounds`,
              "",
              "(summaries of each round of review — detailed reviews in .review.NNN.md files)",
              "",
              `## Rebuttal Plan`,
              "",
              "(response strategy, experiments to add, claims to adjust)",
              "",
            ].join("\n");
          await ResearchFS.writeMd(ResearchFS.resolve("submissions", `${id}.md`), md);

          await ResearchTimeline.append({
            type: "submission.created",
            id,
            title: params.title,
            summary: `Created submission ${id}: ${params.title}${params.venue ? ` → ${params.venue}` : ""}`,
          });

          await updateActivePhaseRun(
            "compose",
            { incrementAttempts: true, summary: `Created submission ${id}` },
            activePhaseRun,
          );

          const lines = [
            `✅ Created ${id}: ${params.title}`,
            "",
            `Files:`,
            `  .research/submissions/${id}.yaml (metadata — managed by tool)`,
            `  .research/submissions/${id}.md (${params.content ? "content written" : "template — fill with venue notes, rebuttal plan"})`,
            "",
            `Status: preparing`,
            ...(params.paper ? [`Paper: ${params.paper}`] : []),
            ...(params.venue ? [`Venue: ${params.venue}`] : []),
          ];

          return {
            title: `Submission created: ${id}`,
            output: lines.join("\n"),
            metadata: mdMeta({ id, path: `.research/submissions/${id}` }),
          };
        }

        if (params.action === "submit") {
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          const prevStatus = yaml.status;
          const transitionError = validateTransition(prevStatus, "submitted");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: prevStatus,
                target: "submitted",
              }),
            };
          }

          const now = new Date().toISOString();
          const date = params.submitted_date ?? now;

          yaml.status = "submitted";
          yaml.submitted_date = date;
          yaml.rounds.push({
            round: yaml.rounds.length + 1,
            status: "submitted",
            date,
            summary: params.summary ?? "Initial submission",
          });

          await writeSubmission(params.id, yaml);
          await appendStatusEvent(
            params.id,
            prevStatus,
            "submitted",
            `${params.id} submitted${yaml.venue ? ` to ${yaml.venue}` : ""}`,
          );

          if (params.notes) await appendNotes("submissions", params.id, "Submit", params.notes);
          await updateActivePhaseRun("compose", { summary: `Submitted ${params.id}` }, activePhaseRun);

          return {
            title: `${params.id} → submitted`,
            output: [
              `✅ ${params.id}: ${prevStatus} → submitted`,
              `Date: ${date}`,
              ...(yaml.venue ? [`Venue: ${yaml.venue}`] : []),
              `Round ${yaml.rounds.length} recorded`,
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: "submitted", submitted_date: date }),
          };
        }

        if (params.action === "record_round") {
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');
          if (!params.round_status)
            return missingParam("round_status", 'Please provide round_status (e.g. "reviews_received").');

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          if (yaml.status === "preparing") {
            return {
              title: "Invalid state",
              output: `Cannot record review rounds for ${params.id} before it has been submitted.`,
              metadata: mdMeta({ error: "invalid_state", id: params.id, status: yaml.status }),
            };
          }
          if (["accepted", "rejected", "closed"].includes(yaml.status)) {
            return {
              title: "Invalid state",
              output: `Cannot record review rounds for ${params.id} because it is terminal (${yaml.status}).`,
              metadata: mdMeta({ error: "invalid_state", id: params.id, status: yaml.status }),
            };
          }

          const prevStatus = yaml.status;
          const now = new Date().toISOString();

          yaml.rounds.push({
            round: yaml.rounds.length + 1,
            status: params.round_status,
            date: now,
            summary: params.summary,
          });

          if (yaml.status === "submitted" || yaml.status === "resubmitted") {
            const validation = validateTransition(yaml.status, "under_review");
            if (validation) {
              return {
                title: "Invalid transition",
                output: `Cannot transition from "${yaml.status}" to "under_review"`,
                metadata: mdMeta({
                  error: "invalid_transition",
                  id: params.id,
                  current: yaml.status,
                  target: "under_review",
                }),
              };
            }
            yaml.status = "under_review";
          }

          await writeSubmission(params.id, yaml);

          if (yaml.status !== prevStatus) {
            await appendStatusEvent(params.id, prevStatus, yaml.status, `${params.id}: ${params.round_status}`);
          }

          await updateActivePhaseRun(
            "compose",
            {
              state: "evaluate",
              summary: `Round ${yaml.rounds.length}: ${params.round_status}`,
            },
            activePhaseRun,
          );

          return {
            title: `${params.id}: round ${yaml.rounds.length}`,
            output: [
              `✅ Round ${yaml.rounds.length} recorded for ${params.id}: ${params.round_status}`,
              ...(yaml.status !== prevStatus ? [`Status: ${prevStatus} → ${yaml.status}`] : []),
              ...(params.summary ? [`Summary: ${params.summary}`] : []),
            ].join("\n"),
            metadata: mdMeta({
              id: params.id,
              round: yaml.rounds.length,
              round_status: params.round_status,
              status: yaml.status,
            }),
          };
        }

        if (params.action === "enter_rebuttal") {
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          const prevStatus = yaml.status;
          const transitionError = validateTransition(prevStatus, "rebuttal");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({ error: "invalid_transition", id: params.id, current: prevStatus, target: "rebuttal" }),
            };
          }

          yaml.status = "rebuttal";

          await writeSubmission(params.id, yaml);
          await appendStatusEvent(params.id, prevStatus, "rebuttal");

          if (params.notes) await appendNotes("submissions", params.id, "Enter Rebuttal", params.notes);
          await updateActivePhaseRun("compose", { summary: `Entered rebuttal for ${params.id}` }, activePhaseRun);

          return {
            title: `${params.id} → rebuttal`,
            output: `✅ ${params.id}: ${prevStatus} → rebuttal`,
            metadata: mdMeta({ id: params.id, status: "rebuttal", previous_status: prevStatus }),
          };
        }

        if (params.action === "request_revision") {
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          const prevStatus = yaml.status;
          const transitionError = validateTransition(prevStatus, "revision_requested");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: prevStatus,
                target: "revision_requested",
              }),
            };
          }

          const now = new Date().toISOString();

          yaml.status = "revision_requested";
          yaml.rounds.push({
            round: yaml.rounds.length + 1,
            status: "revision_requested",
            date: now,
            summary: params.summary,
          });

          await writeSubmission(params.id, yaml);
          await appendStatusEvent(
            params.id,
            prevStatus,
            "revision_requested",
            params.summary ?? `${params.id}: revision requested`,
          );

          if (params.notes) await appendNotes("submissions", params.id, "Request Revision", params.notes);
          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Revision requested for ${params.id}` },
            activePhaseRun,
          );

          return {
            title: `${params.id} → revision_requested`,
            output: [
              `✅ ${params.id}: ${prevStatus} → revision_requested`,
              `Round ${yaml.rounds.length} recorded`,
              ...(params.summary ? [`Summary: ${params.summary}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: "revision_requested", round: yaml.rounds.length }),
          };
        }

        if (params.action === "resubmit") {
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          const prevStatus = yaml.status;
          const transitionError = validateTransition(prevStatus, "resubmitted");
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: prevStatus,
                target: "resubmitted",
              }),
            };
          }

          const now = new Date().toISOString();

          yaml.status = "resubmitted";
          yaml.rounds.push({
            round: yaml.rounds.length + 1,
            status: "resubmitted",
            date: now,
            summary: params.summary,
          });

          await writeSubmission(params.id, yaml);
          await appendStatusEvent(params.id, prevStatus, "resubmitted", params.summary ?? `${params.id}: resubmitted`);

          if (params.notes) await appendNotes("submissions", params.id, "Resubmit", params.notes);
          await updateActivePhaseRun("compose", { summary: `Resubmitted ${params.id}` }, activePhaseRun);

          return {
            title: `${params.id} → resubmitted`,
            output: [
              `✅ ${params.id}: ${prevStatus} → resubmitted`,
              `Round ${yaml.rounds.length} recorded`,
              ...(params.summary ? [`Summary: ${params.summary}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: "resubmitted", round: yaml.rounds.length }),
          };
        }

        if (params.action === "close") {
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');
          if (!params.outcome)
            return missingParam("outcome", 'Please provide outcome: "accepted", "rejected", or "closed".');

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          const prevStatus = yaml.status;
          const transitionError = validateTransition(prevStatus, params.outcome);
          if (transitionError) {
            return {
              title: "Invalid transition",
              output: `❌ ${transitionError}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: prevStatus,
                target: params.outcome,
              }),
            };
          }

          yaml.status = params.outcome;

          await writeSubmission(params.id, yaml);
          await appendStatusEvent(
            params.id,
            prevStatus,
            params.outcome,
            params.summary ?? `${params.id}: ${params.outcome}`,
          );

          if (params.notes) await appendNotes("submissions", params.id, "Close", params.notes);
          await updateActivePhaseRun(
            "compose",
            {
              state: "evaluate",
              summary: `Closed submission ${params.id}: ${params.outcome}`,
            },
            activePhaseRun,
          );

          return {
            title: `${params.id} → ${params.outcome}`,
            output: [
              `✅ ${params.id}: ${prevStatus} → ${params.outcome}`,
              ...(params.summary ? [`Summary: ${params.summary}`] : []),
            ].join("\n"),
            metadata: mdMeta({ id: params.id, status: params.outcome, previous_status: prevStatus }),
          };
        }

        if (params.action === "review") {
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');
          if (!params.reviewer)
            return missingParam("reviewer", "Please provide the reviewer identity (e.g. 'Reviewer 1').");
          if (!params.summary) return missingParam("summary", "Please provide a review summary.");

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          const { round, review_file } = await ResearchReview.addReview("submissions", params.id, {
            reviewer: params.reviewer,
            focus: params.focus,
            verdict: params.verdict,
            summary: params.summary,
            action_items: params.action_items,
            scores: params.scores,
            review_body: params.review_body,
          });

          await ResearchTimeline.append({
            type: "submission.reviewed",
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
          if (!params.id) return missingParam("id", 'Please provide the submission ID (e.g. "sub_001").');

          if (params.status && params.force !== true) {
            return {
              title: "Status change requires force=true",
              output: `Status changes via update require force=true. Prefer semantic actions (submit, enter_rebuttal, request_revision, resubmit, close) for lifecycle transitions. Use force=true only when you have explicit justification to bypass transition validation.`,
              metadata: mdMeta({ error: "force_required", id: params.id, target_status: params.status }),
            };
          }

          const yaml = await readSubmission(params.id);
          if (!yaml) return notFound("Submission", params.id);

          const changes: string[] = [];

          if (params.status && params.status !== yaml.status) {
            const prevStatus = yaml.status;
            log.warn(
              "Transition",
              `Bypassing transition validation via update action: ${yaml.status} → ${params.status}`,
            );
            yaml.status = params.status;
            changes.push(`status: ${prevStatus} → ${params.status}`);

            await appendStatusEvent(params.id, prevStatus, params.status);
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
            if (isTerminalTransition(prevStatus, params.status, SUBMISSION_TRANSITIONS)) {
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

          if (params.venue !== undefined) {
            yaml.venue = params.venue;
            changes.push(`venue: ${params.venue}`);
          }

          if (params.paper !== undefined) {
            yaml.paper = params.paper;
            changes.push(`paper: ${params.paper}`);
          }

          await writeSubmission(params.id, yaml);

          await updateActivePhaseRun(
            "compose",
            {
              state: "evaluate",
              summary: `Updated submission ${params.id}: ${params.status ?? "status change"}`,
            },
            activePhaseRun,
          );

          return {
            title: `${params.id} updated`,
            output: [`✅ Updated ${params.id}`, "", `Changes:`, ...changes.map((c) => `  - ${c}`)].join("\n"),
            metadata: mdMeta({ id: params.id, changes }),
          };
        }

        if (params.action === "list") {
          const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("submissions"));
          const submissions: SubmissionYaml[] = [];

          for (const file of yamlFiles) {
            const yaml = await ResearchFS.readYaml<SubmissionYaml>(ResearchFS.resolve("submissions", file));
            if (yaml) submissions.push(yaml);
          }

          let filtered = submissions;
          if (params.filter_status) filtered = filtered.filter((s) => s.status === params.filter_status);

          if (filtered.length === 0) {
            return {
              title: "Submissions",
              output: "No submissions found.",
              metadata: mdMeta({ count: 0 }),
            };
          }

          const lines = [`=== Submissions (${filtered.length}) ===`, ""];

          for (const sub of filtered) {
            const venue = sub.venue ? ` → ${sub.venue}` : "";
            const paper = sub.paper ? ` (${sub.paper})` : "";
            const rounds = sub.rounds.length > 0 ? ` [${sub.rounds.length} rounds]` : "";
            lines.push(`${sub.id}  [${sub.status}]  ${sub.title}${venue}${paper}${rounds}  → ${entityMdPath(sub.id)}`);
          }

          return {
            title: "Submissions",
            output: lines.join("\n"),
            metadata: mdMeta({
              count: filtered.length,
              submissions: filtered.map((s) => ({
                id: s.id,
                title: s.title,
                status: s.status,
                venue: s.venue,
                md_path: entityMdPath(s.id),
              })),
            }),
          };
        } // end list action
        else {
          return {
            title: "Unknown action",
            output: `Unknown action "${params.action}". Valid actions are: create, submit, record_round, enter_rebuttal, request_revision, resubmit, close, review, list, update.`,
            metadata: mdMeta({ error: "unknown_action" }),
          };
        }
      });
    });
  },
});
