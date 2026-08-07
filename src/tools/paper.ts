import { tool } from "@ericsanchezok/synergy-plugin/tool";
import fs from "fs/promises";
import path from "path";
import z from "zod";
import { scopeDir } from "../ctx";
import { ResearchFS } from "../fs";
import { ResearchId } from "../id";
import { ResearchJournal } from "../journal";
import { withLock } from "../lock";
import { log } from "../log";
import { updateActivePhaseRun } from "../phase-run";
import { ResearchReview } from "../review";
import type { PaperYaml, StateYaml } from "../schema";
import { PaperStatus, ReviewVerdict } from "../schema";
import { ResearchTimeline } from "../timeline";
import {
  appendNotes,
  entityMdPath,
  isTerminalTransition,
  mdMeta,
  missingParam,
  notFound,
  notInitialized,
  paperMutex,
  withGuard,
} from "./shared";

const DESCRIPTION = `Control plane for the manuscript lifecycle — tracks structure, status, claim/exhibit bindings, and review history.

This tool does NOT edit LaTeX or markdown content. The actual manuscript lives in a source directory (default \`paper/\`); this tool manages the metadata overlay: which sections exist, what claims and exhibits are bound, what lifecycle stage the paper is in, and what reviews have been recorded.

## Actions

- **create**: Register a new paper. Assigns an ID (e.g. paper_001), creates .yaml metadata and a .md template (overview, outline, notes). Optionally provide initial sections. Status starts at "outlined".

- **sync_source**: Scan the paper's source directory for .tex/.md files and update the sections array to match what's on disk. Does not change status — use this after restructuring the manuscript.

- **advance**: Move the paper through its lifecycle. Legal transitions:
  \`\`\`
  outlined → drafting → revising → ready → frozen
  frozen → revising  (reopen for edits)
  \`\`\`
  Validates the transition before applying it.

- **archive**: Archive the paper. Sets status to "archived". Use after the paper is no longer active.

- **review**: Record a structured review on the paper. Append-only — does not change status. Supports verdict, scores, action items, and full markdown output.

- **list**: List papers, optionally filtered by status. Only reads .yaml metadata — for full content (outline, editorial notes), read the .md file at the path shown in md_path.

- **update**: Generic metadata update. Can set status directly (bypasses transition validation), venue, sections, claims, or exhibits.

- **bind**: Merge claims and/or exhibits into the paper's existing arrays. Use when composing — new IDs are added without removing existing bindings.

## Lifecycle

\`\`\`
outlined → drafting → revising → ready → frozen → archived
                        ↑                   |
                        └───────────────────┘ (reopen)
\`\`\`

## Key rules

- Only .yaml is managed by this tool. The .md file is a template for editorial notes.
- Actual manuscript content lives in source_dir (default "paper/") and is edited directly.
- Claims and exhibits are bound by ID reference — the tool does not validate they exist.
- Reviews are append-only and do not change paper status.

Typical flow: create → sync_source → advance(drafting) → bind claims/exhibits → advance(revising) → review → advance(ready) → advance(frozen) → archive

Content and Notes:
- Pass content="## Paper Overview\n\n..." on create to write initial narrative plan (replaces empty template).
- Pass notes="..." on advance/archive to record revision context (append-only).
- .md files are append-only research trail — never delete previous content.

Files: .research/manuscripts/ (paper_XXX.yaml + paper_XXX.md + paper_XXX.reviews.jsonl)`;

const PAPER_TRANSITIONS: Record<string, string[]> = {
  outlined: ["drafting"],
  drafting: ["revising"],
  revising: ["ready"],
  ready: ["frozen", "archived"],
  frozen: ["revising", "archived"],
  archived: [],
};

const MD_TEMPLATE = [
  "## Paper Overview",
  "",
  "(high-level narrative plan)",
  "",
  "## Outline",
  "",
  "(section-by-section plan with key points per section)",
  "",
  "## Notes",
  "",
  "(editorial notes, reviewer feedback summary, revision plan)",
  "",
].join("\n");

async function readPaper(id: string): Promise<PaperYaml | undefined> {
  return ResearchFS.readYaml<PaperYaml>(ResearchFS.resolve("manuscripts", `${id}.yaml`));
}

async function writePaper(id: string, yaml: PaperYaml): Promise<void> {
  await ResearchFS.writeYaml(ResearchFS.resolve("manuscripts", `${id}.yaml`), yaml);
}

async function scanSourceFiles(sourceDir: string): Promise<string[]> {
  const fullPath = path.join(scopeDir(), sourceDir);
  try {
    const entries = await fs.readdir(fullPath);
    return entries.filter((e) => e.endsWith(".tex") || e.endsWith(".md")).sort();
  } catch {
    // source directory doesn't exist or is unreadable
    return [];
  }
}

export const researchPaper = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum(["create", "sync_source", "advance", "archive", "review", "list", "update", "bind"])
      .describe("Action to perform"),
    id: z.string().optional().describe("Paper ID (e.g. 'paper_001'). Required for all actions except create and list."),
    title: z.string().optional().describe("Paper title. Required for create."),
    venue: z.string().optional().describe("Target venue. For create/update."),
    source_dir: z
      .string()
      .optional()
      .describe("Directory containing manuscript files, relative to project root. Default: 'paper'. For create."),
    sections: z
      .array(
        z.object({
          name: z.string(),
          file: z.string().optional(),
          status: z.enum(["pending", "drafted", "revised", "final"]).optional(),
        }),
      )
      .optional()
      .describe("Sections array. For create (initial sections) or update (replace sections)."),
    target_status: z
      .enum(["drafting", "revising", "ready", "frozen"])
      .optional()
      .describe("Target lifecycle status. Required for advance."),
    status: PaperStatus.optional().describe("Direct status override for update (bypasses transition validation)."),
    claims: z.array(z.string()).optional().describe("Claim IDs. For update (replace) or bind (merge)."),
    exhibits: z.array(z.string()).optional().describe("Exhibit IDs. For update (replace) or bind (merge)."),
    reviewer: z
      .enum(["inspector", "auditor", "critic", "editor"])
      .optional()
      .describe("Reviewer role performing the review"),
    summary: z.string().optional().describe("Review summary. Required for review."),
    focus: z.string().optional().describe("What aspect was reviewed. For review."),
    verdict: ReviewVerdict.optional().describe("Review verdict: pass, revise, or rethink. For review."),
    action_items: z.array(z.string()).optional().describe("Actionable follow-ups. For review."),
    scores: z
      .record(z.string(), z.number())
      .optional()
      .describe("Numeric scores (e.g. {clarity: 7, rigor: 8}). For review."),
    review_body: z
      .string()
      .optional()
      .describe(
        "Reviewer's full markdown feedback. ONLY for review action. Saved as a separate .review.NNN.md file (not the entity's main .md).",
      ),
    filter_status: PaperStatus.optional().describe("Filter by status. For list."),
    content: z
      .string()
      .optional()
      .describe(
        "Initial .md content for create. Write ## Paper Overview, ## Outline, ## Notes. Replaces empty template.",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Append to .md on advance/archive. Record revision rationale or milestone context. Auto-timestamped, append-only.",
      ),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(paperMutex, async () => {
        if (!(await ResearchFS.isInitialized())) return notInitialized();
        const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
        const activePhaseRun = state?.focus?.active_phase_run;

        if (params.action === "create") {
          if (!params.title) return missingParam("title", "Please provide a title for the paper.");

          const id = await ResearchId.next("paper");
          const now = new Date().toISOString();
          const sourceDir = params.source_dir ?? "paper";

          const initialSections = (params.sections ?? []).map((s) => ({
            name: s.name,
            file: s.file,
            status: s.status ?? ("pending" as const),
          }));

          const yaml: PaperYaml = {
            id,
            title: params.title,
            status: "outlined",
            venue: params.venue,
            source_dir: sourceDir,
            sections: initialSections,
            claims: [],
            exhibits: [],
            created: now,
          };
          await writePaper(id, yaml);
          await ResearchFS.writeMd(ResearchFS.resolve("manuscripts", `${id}.md`), params.content ?? MD_TEMPLATE);

          await ResearchTimeline.append({
            type: "paper.created",
            id,
            title: params.title,
            summary: params.title,
          });

          await updateActivePhaseRun(
            "compose",
            {
              incrementAttempts: true,
              summary: `Created paper ${id}: ${params.title}`,
            },
            activePhaseRun,
          );

          return {
            title: `Paper created: ${id}`,
            output: [
              `✅ Created ${id}: ${params.title}`,
              "",
              `Files:`,
              `  .research/manuscripts/${id}.yaml (metadata — managed by tool)`,
              `  .research/manuscripts/${id}.md (${params.content ? "content written" : "template — fill with overview, outline, notes"})`,
              "",
              `Status: outlined`,
              `Source dir: ${sourceDir}`,
              `Venue: ${params.venue ?? "(not set)"}`,
              `Sections: ${initialSections.length || "none"}`,
            ].join("\n"),
            metadata: mdMeta({ id, path: `.research/manuscripts/${id}` }),
          };
        }

        if (params.action === "sync_source") {
          if (!params.id) return missingParam("id", 'Please provide the paper ID (e.g. "paper_001").');
          const yaml = await readPaper(params.id);
          if (!yaml) return notFound("Paper", params.id);

          const sourceDir = yaml.source_dir ?? "paper";
          const files = await scanSourceFiles(sourceDir);

          const existingByFile = new Map<string, PaperYaml["sections"][number]>();
          for (const sec of yaml.sections) {
            if (sec.file) existingByFile.set(sec.file, sec);
          }

          const updatedSections: PaperYaml["sections"] = files.map((file) => {
            const existing = existingByFile.get(file);
            if (existing) return existing;
            const name = path.basename(file, path.extname(file)).replace(/[-_]/g, " ");
            return { name, file, status: "pending" as const };
          });

          const prevCount = yaml.sections.length;
          yaml.sections = updatedSections;
          await writePaper(params.id, yaml);

          return {
            title: `${params.id} synced`,
            output: [
              `✅ Synced sections for ${params.id} from ${sourceDir}/`,
              "",
              `Previous sections: ${prevCount}`,
              `Current sections: ${updatedSections.length}`,
              "",
              ...updatedSections.map((s) => `  ${s.file ?? "(no file)"}  ${s.name}  [${s.status}]`),
            ].join("\n"),
            metadata: mdMeta({
              id: params.id,
              source_dir: sourceDir,
              section_count: updatedSections.length,
              sections: updatedSections,
            }),
          };
        }

        if (params.action === "advance") {
          if (!params.id) return missingParam("id", 'Please provide the paper ID (e.g. "paper_001").');
          if (!params.target_status)
            return missingParam("target_status", "Please provide the target status to advance to.");

          const yaml = await readPaper(params.id);
          if (!yaml) return notFound("Paper", params.id);

          const allowed = PAPER_TRANSITIONS[yaml.status];
          if (!allowed?.includes(params.target_status)) {
            return {
              title: "Invalid transition",
              output: `Cannot advance ${params.id} from "${yaml.status}" to "${params.target_status}". Allowed: ${(allowed ?? []).join(", ") || "none"}`,
              metadata: mdMeta({
                error: "invalid_transition",
                current: yaml.status,
                target: params.target_status,
                allowed: allowed ?? [],
              }),
            };
          }

          const prevStatus = yaml.status;
          yaml.status = params.target_status;
          await writePaper(params.id, yaml);

          await ResearchTimeline.append({
            type: "paper.status",
            id: params.id,
            from: prevStatus,
            to: params.target_status,
            summary: `${params.id} status: ${prevStatus} → ${params.target_status}`,
          });

          if (params.notes) await appendNotes("manuscripts", params.id, "Advance", params.notes);

          await updateActivePhaseRun(
            "compose",
            {
              state: "evaluate",
              summary: `Advanced paper ${params.id}: ${prevStatus} → ${params.target_status}`,
            },
            activePhaseRun,
          );

          return {
            title: `${params.id} → ${params.target_status}`,
            output: `✅ ${params.id}: ${prevStatus} → ${params.target_status}`,
            metadata: mdMeta({ id: params.id, status: params.target_status, previous_status: prevStatus }),
          };
        }

        if (params.action === "archive") {
          if (!params.id) return missingParam("id", 'Please provide the paper ID (e.g. "paper_001").');

          const yaml = await readPaper(params.id);
          if (!yaml) return notFound("Paper", params.id);

          const allowed = PAPER_TRANSITIONS[yaml.status];
          if (!allowed?.includes("archived")) {
            return {
              title: "Invalid transition",
              output: `Cannot archive paper from status "${yaml.status}". Valid transitions to "archived": ready, frozen.`,
              metadata: mdMeta({
                error: "invalid_transition",
                id: params.id,
                current: yaml.status,
                target: "archived",
                allowed: allowed ?? [],
              }),
            };
          }

          const prevStatus = yaml.status;
          yaml.status = "archived";
          await writePaper(params.id, yaml);

          await ResearchTimeline.append({
            type: "paper.status",
            id: params.id,
            from: prevStatus,
            to: "archived",
            summary: `${params.id} archived`,
          });

          if (params.notes) await appendNotes("manuscripts", params.id, "Archive", params.notes);

          await updateActivePhaseRun(
            "compose",
            { state: "evaluate", summary: `Archived paper ${params.id}` },
            activePhaseRun,
          );

          return {
            title: `${params.id} archived`,
            output: `✅ ${params.id}: ${prevStatus} → archived`,
            metadata: mdMeta({ id: params.id, status: "archived", previous_status: prevStatus }),
          };
        }

        if (params.action === "review") {
          if (!params.id) return missingParam("id", 'Please provide the paper ID (e.g. "paper_001").');
          if (!params.reviewer) return missingParam("reviewer", "Please provide the reviewer identity.");
          if (!params.summary) return missingParam("summary", "Please provide a review summary.");

          const yaml = await readPaper(params.id);
          if (!yaml) return notFound("Paper", params.id);

          const { round, review_file } = await ResearchReview.addReview("manuscripts", params.id, {
            reviewer: params.reviewer,
            focus: params.focus,
            verdict: params.verdict,
            summary: params.summary,
            action_items: params.action_items,
            scores: params.scores,
            review_body: params.review_body,
          });

          await ResearchTimeline.append({
            type: "paper.reviewed",
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
          if (!params.id) return missingParam("id", 'Please provide the paper ID (e.g. "paper_001").');

          const yaml = await readPaper(params.id);
          if (!yaml) return notFound("Paper", params.id);

          const changes: string[] = [];
          const prevStatus = yaml.status;

          if (params.status !== undefined) {
            if (params.status !== prevStatus) {
              log.warn(
                "Transition",
                `Bypassing transition validation via update action: ${prevStatus} → ${params.status}`,
              );
            }
            yaml.status = params.status;
            changes.push(`status: ${prevStatus} → ${params.status}`);
          }
          if (params.venue !== undefined) {
            yaml.venue = params.venue;
            changes.push(`venue: ${params.venue}`);
          }
          if (params.sections !== undefined) {
            yaml.sections = params.sections.map((s) => ({
              name: s.name,
              file: s.file,
              status: s.status ?? ("pending" as const),
            }));
            changes.push(`sections: ${yaml.sections.length} entries`);
          }
          if (params.claims !== undefined) {
            yaml.claims = params.claims;
            changes.push(`claims: [${params.claims.join(", ")}]`);
          }
          if (params.exhibits !== undefined) {
            yaml.exhibits = params.exhibits;
            changes.push(`exhibits: [${params.exhibits.join(", ")}]`);
          }

          if (changes.length === 0) {
            return {
              title: `${params.id} unchanged`,
              output: `No changes provided for ${params.id}.`,
              metadata: mdMeta({ id: params.id }),
            };
          }

          await writePaper(params.id, yaml);

          if (params.status !== undefined && params.status !== prevStatus) {
            await ResearchTimeline.append({
              type: "paper.status",
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
            if (isTerminalTransition(prevStatus, params.status, PAPER_TRANSITIONS)) {
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
            output: [`✅ Updated ${params.id}:`, "", ...changes.map((c) => `  ${c}`)].join("\n"),
            metadata: mdMeta({ id: params.id, changes }),
          };
        }

        if (params.action === "bind") {
          if (!params.id) return missingParam("id", 'Please provide the paper ID (e.g. "paper_001").');

          const yaml = await readPaper(params.id);
          if (!yaml) return notFound("Paper", params.id);

          const added: string[] = [];
          const claimsToAdd: string[] = [];
          const exhibitsToAdd: string[] = [];
          const missingClaims: string[] = [];
          const missingExhibits: string[] = [];

          if (params.claims?.length) {
            const existing = new Set(yaml.claims);
            for (const c of params.claims) {
              if (existing.has(c)) continue;
              existing.add(c);
              const claimExists = await ResearchFS.exists(ResearchFS.resolve("claims", `${c}.yaml`));
              if (!claimExists) {
                missingClaims.push(c);
                continue;
              }
              claimsToAdd.push(c);
            }
          }

          if (params.exhibits?.length) {
            const existing = new Set(yaml.exhibits);
            for (const e of params.exhibits) {
              if (existing.has(e)) continue;
              existing.add(e);
              const exhibitExists = await ResearchFS.exists(ResearchFS.resolve("exhibits", `${e}.yaml`));
              if (!exhibitExists) {
                missingExhibits.push(e);
                continue;
              }
              exhibitsToAdd.push(e);
            }
          }

          if (missingClaims.length > 0 || missingExhibits.length > 0) {
            log.warn(
              "Paper",
              `Bind rejected for ${params.id}: missing refs ${[...missingClaims, ...missingExhibits].join(", ")}`,
            );
            return {
              title: "Dangling refs blocked",
              output: [
                `❌ Cannot bind references to ${params.id}: some refs do not exist.`,
                "",
                ...(missingClaims.length > 0 ? ["Missing claims:", ...missingClaims.map((c) => `  - ${c}`)] : []),
                ...(missingExhibits.length > 0 ? ["Missing exhibits:", ...missingExhibits.map((e) => `  - ${e}`)] : []),
                "",
                "Create the missing entities first, or remove them from the bind request.",
              ].join("\n"),
              metadata: mdMeta({
                error: "dangling_refs",
                id: params.id,
                missing_claims: missingClaims,
                missing_exhibits: missingExhibits,
              }),
            };
          }

          for (const c of claimsToAdd) {
            yaml.claims.push(c);
            added.push(`claim: ${c}`);
          }
          for (const e of exhibitsToAdd) {
            yaml.exhibits.push(e);
            added.push(`exhibit: ${e}`);
          }

          if (added.length === 0) {
            return {
              title: `${params.id} unchanged`,
              output: `No new bindings to add — all provided IDs already bound to ${params.id}.`,
              metadata: mdMeta({ id: params.id }),
            };
          }

          await writePaper(params.id, yaml);

          await ResearchTimeline.append({
            type: "paper.bind",
            phase: "compose",
            summary: `Paper ${params.id} bound to claims/exhibits`,
            id: params.id,
            refs: [params.id, ...(params.claims ?? []), ...(params.exhibits ?? [])],
          });

          return {
            title: `${params.id} bound`,
            output: [
              `✅ Bound to ${params.id}:`,
              "",
              ...added.map((a) => `  + ${a}`),
              "",
              `Total claims: ${yaml.claims.length}`,
              `Total exhibits: ${yaml.exhibits.length}`,
            ].join("\n"),
            metadata: mdMeta({
              id: params.id,
              claims: yaml.claims,
              exhibits: yaml.exhibits,
              added,
            }),
          };
        }

        if (params.action === "list") {
          const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("manuscripts"));
          const papers: PaperYaml[] = [];

          for (const file of yamlFiles) {
            const yaml = await ResearchFS.readYaml<PaperYaml>(ResearchFS.resolve("manuscripts", file));
            if (yaml) papers.push(yaml);
          }

          let filtered = papers;
          if (params.filter_status) filtered = filtered.filter((p) => p.status === params.filter_status);

          if (filtered.length === 0) {
            return {
              title: "Papers",
              output: "No papers found.",
              metadata: mdMeta({ count: 0 }),
            };
          }

          const lines = [`=== Papers (${filtered.length}) ===`, ""];

          for (const paper of filtered) {
            const claimCount = paper.claims.length;
            const exhibitCount = paper.exhibits.length;
            const sectionCount = paper.sections.length;
            lines.push(
              `${paper.id}  [${paper.status}]  ${paper.title}  (${sectionCount} sections, ${claimCount} claims, ${exhibitCount} exhibits)${paper.venue ? `  venue: ${paper.venue}` : ""}  → ${entityMdPath(paper.id)}`,
            );
          }

          return {
            title: "Papers",
            output: lines.join("\n"),
            metadata: mdMeta({
              count: filtered.length,
              papers: filtered.map((p) => ({
                id: p.id,
                title: p.title,
                status: p.status,
                venue: p.venue,
                claims: p.claims.length,
                exhibits: p.exhibits.length,
                md_path: entityMdPath(p.id),
              })),
            }),
          };
        } // end list action
        else {
          return {
            title: "Unknown action",
            output: `Unknown action "${params.action}". Valid actions are: create, sync_source, advance, archive, review, list, update, bind.`,
            metadata: mdMeta({ error: "unknown_action" }),
          };
        }
      });
    });
  },
});
