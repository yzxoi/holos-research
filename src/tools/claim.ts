import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { ResearchId } from "../id";
import { ResearchJournal } from "../journal";
import { withLock } from "../lock";
import { log } from "../log";
import { updateActivePhaseRun } from "../phase-run";
import { ResearchReview } from "../review";
import type { ClaimYaml, ExperimentYaml, StateYaml, StorySpine } from "../schema";
import { ClaimStatus, ReviewVerdict } from "../schema";
import { ResearchTimeline } from "../timeline";
import {
  allRedlinesPassed,
  appendNotes,
  claimMutex,
  entityMdPath,
  isTerminalTransition,
  lineageWarning,
  mdMeta,
  missingParam,
  notFound,
  notInitialized,
  validateAuthenticity,
  withGuard,
} from "./shared";

const DESCRIPTION = `Manage structured research claims — the bridge between experimental evidence and paper text.

Every assertion a paper makes should be backed by a claim object. A claim captures the precise statement being made, the evidence supporting it (with strength ratings), the caveats that must accompany it, and which paper section it belongs to. This makes the evidence chain auditable: reviewers, co-authors, and the agent itself can trace any paper sentence back to the experiments and results that justify it.

## Status lifecycle

\`\`\`
candidate → supported → final
         → qualified → final
         → weak
         → retracted
\`\`\`

- **candidate**: newly registered, evidence not yet assessed
- **supported**: evidence fully supports the claim as stated
- **qualified**: evidence supports the claim, but with caveats (conditions, scope limits)
- **weak**: evidence is insufficient — claim needs stronger backing or should be reframed
- **retracted**: claim withdrawn (evidence contradicts it, or it's no longer relevant)
- **final**: locked into the paper's final claim set (only from supported/qualified)

## Actions

- **create**: Register a new claim with a title, optional statement, evidence refs, caveats, and paper section. Creates .yaml + .md template.
- **support**: Mark a claim as fully supported by its evidence.
- **qualify**: Mark a claim as supported-with-caveats. Merges new caveats into existing ones.
- **weaken**: Mark a claim as insufficiently supported.
- **retract**: Withdraw a claim.
- **finalize**: Lock a claim into the paper's final set. Only allowed from supported or qualified status.
- **review**: Record a structured review on a claim. Reviews are append-only and don't change status.
- **trace**: Show the full evidence chain — all evidence refs with roles and strengths, all caveats. Use this to audit whether a claim is well-supported before promoting it.
- **list**: List claims with optional status filter. Only reads .yaml metadata — for full content (evidence reasoning, statistical details, conditions), read the .md file at the path shown in md_path.
- **update**: Generic update for fields not covered by semantic actions (statement, evidence, caveats, paper_section, status). Merges array fields.

## Key rules

- Only .yaml is managed by this tool. The .md file is for free editing.
- Evidence refs should point to experiment IDs (e.g. exp_007) or other trackable objects.
- Use trace before finalize to verify the evidence chain.
- Reviews inform decisions but don't change status directly.

Typical flow: create → edit .md → add evidence via update → review → support/qualify → finalize

Content and Notes:
- Pass content="## Claim Statement\n\n..." on create to write the claim reasoning (replaces empty template).
- Pass notes="..." on support/qualify/weaken/retract/finalize to append evidence analysis (append-only).
- .md files are append-only research trail — never delete previous content.

Files: .research/claims/ (claim_XXX.yaml + claim_XXX.md + claim_XXX.reviews.jsonl)`;

const CLAIM_TRANSITIONS: Record<string, string[]> = {
  candidate: ["supported", "qualified", "weak", "retracted"],
  supported: ["final", "qualified"],
  qualified: ["final"],
  weak: ["candidate"], // Can be re-candidate with new evidence
  retracted: [],
  final: [],
};

async function readClaim(id: string): Promise<ClaimYaml | undefined> {
  return ResearchFS.readYaml<ClaimYaml>(ResearchFS.resolve("claims", `${id}.yaml`));
}

async function writeClaim(id: string, yaml: ClaimYaml): Promise<void> {
  await ResearchFS.writeYaml(ResearchFS.resolve("claims", `${id}.yaml`), yaml);
}

async function transitionStatus(
  id: string,
  toStatus: ClaimYaml["status"],
  opts: { reason?: string; bypassValidation?: boolean } = {},
): Promise<ReturnType<typeof notFound> | { title: string; output: string; metadata: Record<string, any> }> {
  const yaml = await readClaim(id);
  if (!yaml) return notFound("Claim", id);

  const prevStatus = yaml.status;

  if (toStatus === prevStatus) {
    return {
      title: `${id} unchanged`,
      output: `${id} already has status "${prevStatus}".`,
      metadata: mdMeta({ id, status: prevStatus }),
    };
  }

  if (!opts.bypassValidation) {
    const allowed = CLAIM_TRANSITIONS[prevStatus];
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

  await writeClaim(id, yaml);

  await ResearchTimeline.append({
    type: "claim.status",
    id,
    from: prevStatus,
    to: toStatus,
    summary: opts.reason ?? `${id} status: ${prevStatus} → ${toStatus}`,
  });

  return {
    title: `${id} → ${toStatus}`,
    output: [`✅ ${id}: ${prevStatus} → ${toStatus}`, ...(opts.reason ? [`Reason: ${opts.reason}`] : [])].join("\n"),
    metadata: mdMeta({ id, status: toStatus, previous_status: prevStatus }),
  };
}

const EvidenceItem = z.object({
  ref: z.string(),
  role: z.string().optional(),
  strength: z.enum(["strong", "moderate", "weak"]).optional(),
});

export const researchClaim = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["create", "support", "qualify", "weaken", "retract", "finalize", "review", "trace", "list", "update"])
      .describe("Semantic action to perform"),
    id: z.string().optional().describe("Claim ID (e.g. 'claim_003'). Required for all actions except create and list."),
    title: z.string().optional().describe("Claim title. Required for create."),
    statement: z.string().optional().describe("Precise statement of what is being claimed. For create/update."),
    evidence: z
      .array(EvidenceItem)
      .optional()
      .describe(
        "Evidence supporting this claim. Each entry has ref (e.g. 'exp_007'), optional role (e.g. 'primary', 'supporting'), optional strength ('strong'/'moderate'/'weak'). For create/update.",
      ),
    caveats: z
      .array(z.string())
      .optional()
      .describe(
        "Conditions or limitations on the claim (e.g. 'only tested on English data'). For create/qualify/update.",
      ),
    paper_section: z
      .string()
      .optional()
      .describe("Which paper section this claim belongs to (e.g. 'results', 'discussion'). For create/update."),
    story_ref: z.string().optional().describe("Story spine ID this claim derives from, e.g. 'story_001'. For create."),
    status: ClaimStatus.optional().describe("Target status. For update action only."),
    reason: z.string().optional().describe("Reason for the status change. For support/qualify/weaken/retract."),
    reviewer: z
      .enum(["inspector", "auditor", "critic", "editor"])
      .optional()
      .describe("Reviewer role performing the review"),
    summary: z.string().optional().describe("Review summary. Required for review."),
    focus: z.string().optional().describe("What aspect was reviewed (e.g. 'evidence sufficiency'). For review."),
    verdict: ReviewVerdict.optional().describe("Review verdict: pass, revise, or rethink. For review."),
    action_items: z.array(z.string()).optional().describe("Actionable follow-ups from review. For review."),
    scores: z
      .record(z.string(), z.number())
      .optional()
      .describe("Numeric scores (e.g. {evidence_strength: 8, clarity: 7}). For review."),
    review_body: z
      .string()
      .optional()
      .describe(
        "Reviewer's full markdown feedback. ONLY for review action. Saved as a separate .review.NNN.md file (not the entity's main .md).",
      ),
    filter_status: ClaimStatus.optional().describe("Filter by status. For list."),
    content: z
      .string()
      .optional()
      .describe(
        "Initial .md content for create. Write ## Claim Statement, ## Evidence Summary, ## Caveats. Replaces empty template.",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Append to .md on support/qualify/weaken/retract/finalize. Explain evidence reasoning. Auto-timestamped, append-only.",
      ),
    force: z
      .boolean()
      .optional()
      .describe("Set to true to allow status changes via update action. Prefer semantic actions instead."),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(claimMutex, async () => {
        if (!(await ResearchFS.isInitialized())) return notInitialized();
        const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
        const activePhaseRun = state?.focus?.active_phase_run;

        if (params.action === "create") {
          if (!params.title) return missingParam("title", "Please provide a title for the claim.");

          const id = await ResearchId.next("claim");
          const now = new Date().toISOString();

          const yaml: ClaimYaml = {
            id,
            title: params.title,
            status: "candidate",
            statement: params.statement,
            evidence: params.evidence ?? [],
            caveats: params.caveats ?? [],
            paper_section: params.paper_section,
            story_ref: params.story_ref,
            created: now,
          };
          await writeClaim(id, yaml);

          const md =
            params.content ??
            [
              `## Claim Statement`,
              "",
              "(precise statement of what is being claimed)",
              "",
              `## Evidence Summary`,
              "",
              "(which experiments/results support this and how)",
              "",
              `## Caveats & Limitations`,
              "",
              "(conditions under which this claim holds, known limitations)",
              "",
              `## Notes`,
              "",
              "(additional analysis, reviewer feedback summary)",
              "",
            ].join("\n");
          await ResearchFS.writeMd(ResearchFS.resolve("claims", `${id}.md`), md);

          await ResearchTimeline.append({
            type: "claim.created",
            id,
            title: params.title,
            summary: params.title,
          });

          await updateActivePhaseRun(
            "compose",
            {
              incrementAttempts: true,
              summary: `Created claim ${id}: ${params.statement?.slice(0, 60)}`,
            },
            activePhaseRun,
          );

          // ── Back-link: update story spine's claim_refs ──
          if (params.story_ref) {
            try {
              const storyFiles = await ResearchFS.listYaml(ResearchFS.resolve("positioning"));
              for (const file of storyFiles) {
                if (!file.endsWith(".story.yaml")) continue;
                const spine = await ResearchFS.readYaml<StorySpine>(ResearchFS.resolve("positioning", file));
                if (spine && spine.id === params.story_ref) {
                  if (!spine.claim_refs) spine.claim_refs = [];
                  if (!spine.claim_refs.includes(id)) {
                    spine.claim_refs.push(id);
                    await ResearchFS.writeYaml(ResearchFS.resolve("positioning", file), spine);
                  }
                  break;
                }
              }
            } catch (err) {
              log.warn("BackLink", "Failed to update spine.claim_refs:", err);
            }
          }

          const lines = [
            `✅ Created ${id}: ${params.title}`,
            "",
            `Files:`,
            `  .research/claims/${id}.yaml (metadata — managed by tool)`,
            `  .research/claims/${id}.md (${params.content ? "content written" : "template — fill with claim statement, evidence, caveats"})`,
            "",
            `Status: candidate`,
            ...(params.statement ? [`Statement: ${params.statement}`] : []),
            ...(params.evidence?.length ? [`Evidence: ${params.evidence.length} ref(s)`] : []),
            ...(params.caveats?.length ? [`Caveats: ${params.caveats.length}`] : []),
            ...(params.paper_section ? [`Paper section: ${params.paper_section}`] : []),
            ...(params.story_ref ? [`Story: ${params.story_ref}`] : []),
          ];

          return {
            title: `Claim created: ${id}`,
            output: lines.join("\n") + lineageWarning("claim", params),
            metadata: mdMeta({ id, path: `.research/claims/${id}` }),
          };
        }

        if (params.action === "support") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');

          // Red-line gate: verify all evidence experiments pass red-lines
          const yaml = await readClaim(params.id);
          if (!yaml) return notFound("Claim", params.id);

          const expRefs = yaml.evidence.filter((e) => e.ref.startsWith("exp_"));
          const nonExpRefs = yaml.evidence.filter((e) => !e.ref.startsWith("exp_"));
          const violations: string[] = [];
          const incompleteEvidence: string[] = [];
          const nonEvidence: string[] = [];
          for (const ev of expRefs) {
            const expYaml = await ResearchFS.readYaml<ExperimentYaml>(
              ResearchFS.resolve("experiments", `${ev.ref}.yaml`),
            );
            if (!expYaml) {
              nonEvidence.push(`${ev.ref}: experiment YAML not found`);
              continue;
            }
            if (expYaml.status !== "completed") {
              incompleteEvidence.push(`${ev.ref}: experiment status is "${expYaml.status}", must be "completed"`);
              continue;
            }
            if (expYaml.redlines && !allRedlinesPassed(expYaml.redlines)) {
              const failed = expYaml.redlines.rules.filter(
                (r) => expYaml.redlines!.status[r] !== "passed" && expYaml.redlines!.status[r] !== "waived",
              );
              violations.push(`${ev.ref}: ${failed.join(", ")}`);
            }
            const authError = validateAuthenticity(expYaml.authenticity, "claim_support");
            if (authError) nonEvidence.push(`${ev.ref}: ${authError}`);
          }
          // Non-experiment evidence (e.g., code_artifacts) — accepted without experiment-level validation
          if (nonExpRefs.length > 0) {
            log.info(
              "Claim",
              `${params.id} has ${nonExpRefs.length} non-experiment evidence ref(s), skipping red-line/authenticity check`,
            );
          }

          if (violations.length > 0) {
            return {
              title: "Red-line gate blocked",
              output: [
                `❌ Cannot support ${params.id}: evidence experiments have red-line violations.`,
                "",
                ...violations.map((v) => `  - ${v}`),
                "",
                "Fix the violations or mark the claim as 'qualified' with caveats instead.",
              ].join("\n"),
              metadata: mdMeta({ id: params.id, error: "redline_blocked", violations }),
            };
          }

          if (incompleteEvidence.length > 0) {
            return {
              title: "Evidence status gate blocked",
              output: [
                `❌ Cannot support ${params.id}: evidence experiments are not completed.`,
                "",
                ...incompleteEvidence.map((v) => `  - ${v}`),
                "",
                "Only completed experiments can support claims.",
              ].join("\n"),
              metadata: mdMeta({ id: params.id, error: "incomplete_evidence", incomplete: incompleteEvidence }),
            };
          }

          if (nonEvidence.length > 0) {
            return {
              title: "Authenticity gate blocked",
              output: [
                `❌ Cannot support ${params.id}: evidence experiments are not evidence-grade.`,
                "",
                ...nonEvidence.map((v) => `  - ${v}`),
                "",
                "Only evidence-grade experiments (full benchmark, official evaluator, complete scale)",
                "can support claims. Prototypes and pilots are for debugging and direction validation.",
                "",
                "Re-run the experiments at evidence scale, or mark the claim as 'qualified' with caveats.",
              ].join("\n"),
              metadata: mdMeta({ id: params.id, error: "authenticity_blocked", non_evidence: nonEvidence }),
            };
          }

          const result = await transitionStatus(params.id, "supported", { reason: params.reason });
          if (params.notes) await appendNotes("claims", params.id, "Support", params.notes);
          await updateActivePhaseRun(
            "compose",
            {
              state: "evaluate",
              summary: `Updated claim ${params.id}: ${params.action}`,
            },
            activePhaseRun,
          );
          return result;
        }

        if (params.action === "qualify") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');

          const yaml = await readClaim(params.id);
          if (!yaml) return notFound("Claim", params.id);

          // Soft red-line check: warn if evidence has violated red-lines (doesn't block qualify)
          const redlineWarnings: string[] = [];
          const expRefs = yaml.evidence.filter((e) => e.ref.startsWith("exp_"));
          for (const ev of expRefs) {
            const expYaml = await ResearchFS.readYaml<ExperimentYaml>(
              ResearchFS.resolve("experiments", `${ev.ref}.yaml`),
            );
            if (expYaml?.redlines && !allRedlinesPassed(expYaml.redlines)) {
              const failed = expYaml.redlines.rules.filter(
                (r) => expYaml.redlines!.status[r] !== "passed" && expYaml.redlines!.status[r] !== "waived",
              );
              redlineWarnings.push(`${ev.ref}: ${failed.join(", ")}`);
            }
          }
          if (redlineWarnings.length > 0) {
            log.warn(
              "RedlineCheck",
              `Claim ${params.id} qualified despite red-line violations: ${redlineWarnings.join("; ")}`,
            );
          }

          // Validate transition before applying
          const allowed = CLAIM_TRANSITIONS[yaml.status];
          if (!allowed?.includes("qualified")) {
            return {
              title: "Invalid transition",
              output: `Cannot qualify claim from status "${yaml.status}". Allowed: ${(allowed ?? []).join(", ") || "none"}`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: yaml.status,
                target: "qualified",
                allowed: allowed ?? [],
              }),
            };
          }

          if (params.caveats?.length) {
            const existing = new Set(yaml.caveats);
            for (const c of params.caveats) existing.add(c);
            yaml.caveats = [...existing];
          }

          const prevStatus = yaml.status;
          yaml.status = "qualified";
          await writeClaim(params.id, yaml);

          await ResearchTimeline.append({
            type: "claim.status",
            id: params.id,
            from: prevStatus,
            to: "qualified",
            summary: params.reason ?? `${params.id} status: ${prevStatus} → qualified`,
          });

          if (params.notes) await appendNotes("claims", params.id, "Qualify", params.notes);

          await updateActivePhaseRun(
            "compose",
            {
              state: "evaluate",
              summary: `Updated claim ${params.id}: ${params.action}`,
            },
            activePhaseRun,
          );

          return {
            title: `${params.id} → qualified`,
            output: [
              `✅ ${params.id}: ${prevStatus} → qualified`,
              ...(params.reason ? [`Reason: ${params.reason}`] : []),
              `Caveats (${yaml.caveats.length}):`,
              ...yaml.caveats.map((c) => `  - ${c}`),
              ...(redlineWarnings.length > 0
                ? [
                    "",
                    `⚠️ Warning: evidence experiments have red-line violations (not blocking for qualified claims):`,
                    ...redlineWarnings.map((w) => `  - ${w}`),
                    "Finalizing will be blocked until red-lines pass or are waived.",
                  ]
                : []),
            ].join("\n"),
            metadata: mdMeta({
              id: params.id,
              status: "qualified",
              previous_status: prevStatus,
              caveats: yaml.caveats,
            }),
          };
        }

        if (params.action === "weaken") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');
          const result = await transitionStatus(params.id, "weak", { reason: params.reason });
          if (params.notes) await appendNotes("claims", params.id, "Weaken", params.notes);
          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Weakened claim ${params.id}` },
            activePhaseRun,
          );
          return result;
        }

        if (params.action === "retract") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');
          const result = await transitionStatus(params.id, "retracted", { reason: params.reason });
          if (params.notes) await appendNotes("claims", params.id, "Retract", params.notes);
          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Retracted claim ${params.id}` },
            activePhaseRun,
          );
          return result;
        }

        if (params.action === "finalize") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');

          // Red-line and authenticity gate: verify all evidence experiments pass
          const yaml = await readClaim(params.id);
          if (!yaml) return notFound("Claim", params.id);

          const evidenceRefs = yaml.evidence.filter((e) => e.ref.startsWith("exp_"));
          if (evidenceRefs.length === 0) {
            return {
              title: "Cannot finalize",
              output: "Claim must have at least one evidence experiment (exp_*) before finalization.",
              metadata: mdMeta({ error: "no_evidence", id: params.id }),
            };
          }

          const expRefs = evidenceRefs;
          const violations: string[] = [];
          const nonEvidence: string[] = [];
          for (const ev of expRefs) {
            const expYaml = await ResearchFS.readYaml<ExperimentYaml>(
              ResearchFS.resolve("experiments", `${ev.ref}.yaml`),
            );
            if (!expYaml) continue;
            if (expYaml.redlines && !allRedlinesPassed(expYaml.redlines)) {
              const failed = expYaml.redlines.rules.filter(
                (r) => expYaml.redlines!.status[r] !== "passed" && expYaml.redlines!.status[r] !== "waived",
              );
              violations.push(`${ev.ref}: ${failed.join(", ")}`);
            }
            const authError = validateAuthenticity(expYaml.authenticity, "claim_support");
            if (authError) nonEvidence.push(`${ev.ref}: ${authError}`);
          }

          if (violations.length > 0) {
            return {
              title: "Red-line gate blocked",
              output: [
                `❌ Cannot finalize ${params.id}: evidence experiments have red-line violations.`,
                "",
                ...violations.map((v) => `  - ${v}`),
                "",
                "All red-lines must pass or be waived before a claim can be finalized.",
                "Fix the violations, waive the red-lines, or remove the evidence reference.",
              ].join("\n"),
              metadata: mdMeta({ id: params.id, error: "redline_blocked", violations }),
            };
          }

          if (nonEvidence.length > 0) {
            return {
              title: "Authenticity gate blocked",
              output: [
                `❌ Cannot finalize ${params.id}: evidence experiments are not evidence-grade.`,
                "",
                ...nonEvidence.map((v) => `  - ${v}`),
                "",
                "Only evidence-grade experiments can support finalized claims.",
              ].join("\n"),
              metadata: mdMeta({ id: params.id, error: "authenticity_blocked", non_evidence: nonEvidence }),
            };
          }

          const result = await transitionStatus(params.id, "final", { reason: params.reason });
          if (params.notes) await appendNotes("claims", params.id, "Finalize", params.notes);
          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Finalized claim ${params.id}` },
            activePhaseRun,
          );
          return result;
        }

        if (params.action === "review") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');
          if (!params.reviewer) return missingParam("reviewer", "Please provide the reviewer identity.");
          if (!params.summary) return missingParam("summary", "Please provide a review summary.");

          const yaml = await readClaim(params.id);
          if (!yaml) return notFound("Claim", params.id);

          const { round, review_file } = await ResearchReview.addReview("claims", params.id, {
            reviewer: params.reviewer,
            focus: params.focus,
            verdict: params.verdict,
            summary: params.summary,
            action_items: params.action_items,
            scores: params.scores,
            review_body: params.review_body,
          });

          await ResearchTimeline.append({
            type: "claim.reviewed",
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

        if (params.action === "trace") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');

          const yaml = await readClaim(params.id);
          if (!yaml) return notFound("Claim", params.id);

          const lines = [
            `=== Evidence trace for ${params.id} ===`,
            "",
            `Title: ${yaml.title}`,
            `Status: ${yaml.status}`,
            ...(yaml.statement ? [`Statement: ${yaml.statement}`] : []),
            ...(yaml.paper_section ? [`Paper section: ${yaml.paper_section}`] : []),
            "",
          ];

          if (yaml.evidence.length > 0) {
            lines.push(`Evidence (${yaml.evidence.length}):`);
            for (const ev of yaml.evidence) {
              const parts = [ev.ref];
              if (ev.role) parts.push(`role=${ev.role}`);
              if (ev.strength) parts.push(`strength=${ev.strength}`);
              lines.push(`  - ${parts.join("  ")}`);
            }
          } else {
            lines.push("Evidence: (none)");
          }

          lines.push("");

          if (yaml.caveats.length > 0) {
            lines.push(`Caveats (${yaml.caveats.length}):`);
            for (const c of yaml.caveats) {
              lines.push(`  - ${c}`);
            }
          } else {
            lines.push("Caveats: (none)");
          }

          const reviews = await ResearchReview.readReviews("claims", params.id);
          if (reviews.length > 0) {
            lines.push("");
            lines.push(`Reviews (${reviews.length}):`);
            for (const r of reviews) {
              lines.push(`  Round ${r.round} by ${r.reviewer}: ${r.verdict ?? "no verdict"} — ${r.summary}`);
            }
          }

          return {
            title: `Trace: ${params.id}`,
            output: lines.join("\n"),
            metadata: mdMeta({
              id: params.id,
              status: yaml.status,
              evidence_count: yaml.evidence.length,
              caveat_count: yaml.caveats.length,
              review_count: reviews.length,
            }),
          };
        }

        if (params.action === "update") {
          if (!params.id) return missingParam("id", 'Please provide the claim ID (e.g. "claim_003").');

          if (params.status && params.force !== true) {
            return {
              title: "Status change requires force=true",
              output: `Status changes via update require force=true. Prefer semantic actions (support, qualify, weaken, retract, finalize) for lifecycle transitions. Use force=true only when you have explicit justification to bypass transition validation.`,
              metadata: mdMeta({ error: "force_required", id: params.id, target_status: params.status }),
            };
          }

          const yaml = await readClaim(params.id);
          if (!yaml) return notFound("Claim", params.id);

          const changes: string[] = [];

          if (params.status && params.status !== yaml.status) {
            const prevStatus = yaml.status;

            // Enforce red-line and authenticity gates for any "promotion" status
            // (supported, qualified, final). audit#2 P0-2: force=true previously
            // bypassed gates for supported/qualified — only final was protected.
            const PROMOTION_STATUSES = new Set(["supported", "qualified", "final"]);
            if (PROMOTION_STATUSES.has(params.status)) {
              const evidenceRefs = yaml.evidence.filter((e) => e.ref.startsWith("exp_"));
              const violations: string[] = [];
              const incompleteEvidence: string[] = [];
              const nonEvidence: string[] = [];
              for (const ev of evidenceRefs) {
                const expYaml = await ResearchFS.readYaml<ExperimentYaml>(
                  ResearchFS.resolve("experiments", `${ev.ref}.yaml`),
                );
                if (!expYaml) continue;
                if (expYaml.status !== "completed") {
                  incompleteEvidence.push(`${ev.ref}: status "${expYaml.status}", must be "completed"`);
                  continue;
                }
                if (expYaml.redlines && !allRedlinesPassed(expYaml.redlines)) {
                  const failed = expYaml.redlines.rules.filter(
                    (r) => expYaml.redlines!.status[r] !== "passed" && expYaml.redlines!.status[r] !== "waived",
                  );
                  violations.push(`${ev.ref}: ${failed.join(", ")}`);
                }
                const authError = validateAuthenticity(expYaml.authenticity, "claim_support");
                if (authError) nonEvidence.push(`${ev.ref}: ${authError}`);
              }
              if (violations.length > 0) {
                return {
                  title: "Red-line gate blocked",
                  output: [
                    `❌ Cannot override ${params.id} to "${params.status}": evidence experiments have red-line violations.`,
                    "",
                    ...violations.map((v) => `  - ${v}`),
                    "",
                    "All red-lines must pass or be waived before a claim can be promoted.",
                    `Use the ${params.status === "final" ? "finalize" : params.status === "supported" ? "support" : "qualify"} action to go through proper validation.`,
                  ].join("\n"),
                  metadata: mdMeta({
                    id: params.id,
                    error: "redline_blocked",
                    target_status: params.status,
                    violations,
                  }),
                };
              }
              if (incompleteEvidence.length > 0) {
                return {
                  title: "Evidence status gate blocked",
                  output: [
                    `❌ Cannot override ${params.id} to "${params.status}": evidence experiments are not completed.`,
                    "",
                    ...incompleteEvidence.map((v) => `  - ${v}`),
                    "",
                    "Only completed experiments can support promoted claims.",
                  ].join("\n"),
                  metadata: mdMeta({
                    id: params.id,
                    error: "incomplete_evidence",
                    target_status: params.status,
                    incomplete: incompleteEvidence,
                  }),
                };
              }
              if (nonEvidence.length > 0) {
                return {
                  title: "Authenticity gate blocked",
                  output: [
                    `❌ Cannot override ${params.id} to "${params.status}": evidence experiments are not evidence-grade.`,
                    "",
                    ...nonEvidence.map((v) => `  - ${v}`),
                    "",
                    "Only evidence-grade experiments can support promoted claims.",
                  ].join("\n"),
                  metadata: mdMeta({
                    id: params.id,
                    error: "authenticity_blocked",
                    target_status: params.status,
                    non_evidence: nonEvidence,
                  }),
                };
              }
            }

            log.warn(
              "Transition",
              `Bypassing transition validation via update action: ${yaml.status} → ${params.status}`,
            );
            yaml.status = params.status;
            changes.push(`status: ${prevStatus} → ${params.status}`);

            await ResearchTimeline.append({
              type: "claim.status",
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
            if (isTerminalTransition(prevStatus, params.status, CLAIM_TRANSITIONS)) {
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

          if (params.statement !== undefined) {
            yaml.statement = params.statement;
            changes.push("statement updated");
          }

          if (params.paper_section !== undefined) {
            yaml.paper_section = params.paper_section;
            changes.push(`paper_section: ${params.paper_section}`);
          }

          if (params.evidence?.length) {
            const existingRefs = new Set(yaml.evidence.map((e) => e.ref));
            for (const ev of params.evidence) {
              if (!existingRefs.has(ev.ref)) {
                yaml.evidence.push(ev);
                existingRefs.add(ev.ref);
              }
            }
            changes.push(`evidence: ${yaml.evidence.length} ref(s)`);
          }

          if (params.caveats?.length) {
            const existing = new Set(yaml.caveats);
            for (const c of params.caveats) existing.add(c);
            yaml.caveats = [...existing];
            changes.push(`caveats: ${yaml.caveats.length}`);
          }

          await writeClaim(params.id, yaml);

          return {
            title: `${params.id} updated`,
            output: [`✅ Updated ${params.id}`, "", `Changes:`, ...changes.map((c) => `  - ${c}`)].join("\n"),
            metadata: mdMeta({ id: params.id, changes }),
          };
        }

        if (params.action === "list") {
          const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("claims"));
          const claims: ClaimYaml[] = [];

          for (const file of yamlFiles) {
            const yaml = await ResearchFS.readYaml<ClaimYaml>(ResearchFS.resolve("claims", file));
            if (yaml) claims.push(yaml);
          }

          let filtered = claims;
          if (params.filter_status) filtered = filtered.filter((c) => c.status === params.filter_status);

          if (filtered.length === 0) {
            return {
              title: "Claims",
              output: "No claims found.",
              metadata: mdMeta({ count: 0 }),
            };
          }

          const lines = [`=== Claims (${filtered.length}) ===`, ""];

          for (const claim of filtered) {
            const ev = claim.evidence.length > 0 ? ` (${claim.evidence.length} evidence)` : "";
            const cav = claim.caveats.length > 0 ? ` (${claim.caveats.length} caveats)` : "";
            const sec = claim.paper_section ? ` [${claim.paper_section}]` : "";
            lines.push(`${claim.id}  [${claim.status}]  ${claim.title}${ev}${cav}${sec}  → ${entityMdPath(claim.id)}`);
          }

          return {
            title: "Claims",
            output: lines.join("\n"),
            metadata: mdMeta({
              count: filtered.length,
              claims: filtered.map((c) => ({
                id: c.id,
                title: c.title,
                status: c.status,
                md_path: entityMdPath(c.id),
              })),
            }),
          };
        } // end list action
        else {
          return {
            title: "Unknown action",
            output: `Unknown action "${params.action}". Valid actions are: create, support, qualify, weaken, retract, finalize, review, trace, list, update.`,
            metadata: mdMeta({ error: "unknown_action" }),
          };
        }
      });
    });
  },
});
