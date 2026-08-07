import type { ToolResult } from "@ericsanchezok/synergy-plugin";
import path from "path";
import { JsonlCorruptError, ResearchFS, YamlCorruptError } from "../fs";
import { getMutex, withLock } from "../lock";
import { log } from "../log";
import type { EvidenceAuthenticity, ExperimentRedline, RedlineRule, RedlineStatus } from "../schema";

const mdMutex = getMutex("md_write");

// ── Per-entity-type mutexes ──────────────────────────────────────────────────
export const ideaMutex = getMutex("entity_idea");
export const planMutex = getMutex("entity_plan");
export const experimentMutex = getMutex("entity_experiment");
export const claimMutex = getMutex("entity_claim");
export const exhibitMutex = getMutex("entity_exhibit");
export const paperMutex = getMutex("entity_paper");
export const submissionMutex = getMutex("entity_submission");

/**
 * Construct tool metadata without requiring `as Record<string, any>`.
 * This is a type-safe convenience wrapper — the result satisfies
 * `Record<string, unknown>` which matches `ToolResult.metadata`.
 */
export function mdMeta(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function notInitialized(): ToolResult {
  return {
    title: "Not initialized",
    output: "No research project found in this scope. Call research_init first.",
    metadata: { error: "not_initialized" },
  };
}

export function notFound(entityType: string, id: string): ToolResult {
  return {
    title: "Not found",
    output: `${entityType} ${id} not found.`,
    metadata: { error: "not_found" },
  };
}

export function missingParam(name: string, hint: string): ToolResult {
  return {
    title: `Missing ${name}`,
    output: hint,
    metadata: { error: `missing_${name}` },
  };
}

/** Infer entity type from file path and return its required YAML fields. */
function schemaHint(filePath: string): string {
  const base = path.basename(filePath);
  const dir = path.basename(path.dirname(filePath));

  if (base === "state.yaml")
    return `Required fields for state.yaml:
  project: string, created: string, updated: string,
  config: {participation_mode, venue?, exploration: {depth, pilot}},
  counters: {idea, plan, exp, claim, exh, paper, sub},
  focus?: {since, phase, summary?, reason?, refs?, blocked_on?, next?},
  anchor?: string`;

  if (dir === "ideas")
    return `Required fields for idea YAML:
  id: string (e.g. "idea_003"), title: string, status: one of [proposed, exploring, grounding, selected, parked, rejected], created: string (ISO date), round: number (default 1)`;

  if (dir === "plans")
    return `Required fields for plan YAML:
  id: string (e.g. "plan_002"), title: string, status: one of [draft, refining, approved, active, superseded, cancelled], created: string (ISO date)`;

  if (dir === "experiments")
    return `Required fields for experiment YAML:
  id: string (e.g. "exp_007"), title: string, status: one of [registered, scheduled, running, completed, failed, invalidated, stopped], created: string (ISO date)`;

  if (dir === "claims")
    return `Required fields for claim YAML:
  id: string (e.g. "claim_001"), title: string, status: one of [candidate, supported, qualified, weak, retracted, final], created: string (ISO date)`;

  if (dir === "exhibits")
    return `Required fields for exhibit YAML:
  id: string (e.g. "exh_003"), title: string, kind: one of [figure, table, supplementary_figure, supplementary_table, extended_data, appendix], status: one of [draft, rendered, verified, approved, superseded, dropped], created: string (ISO date)`;

  if (dir === "manuscripts")
    return `Required fields for paper YAML:
  id: string (e.g. "paper_001"), title: string, status: one of [outlined, drafting, revising, ready, frozen, archived], created: string (ISO date)`;

  if (dir === "submissions")
    return `Required fields for submission YAML:
  id: string (e.g. "sub_001"), title: string, status: one of [preparing, submitted, under_review, rebuttal, revision_requested, resubmitted, accepted, rejected, closed], created: string (ISO date)`;

  if (base === "gap_map.yaml")
    return `Required structure for gap_map.yaml:
  gaps: array of {id: string, description: string, status: one of [open, partially_addressed, closed], created: string}`;

  if (dir === "papers" && base.endsWith(".yaml"))
    return `Required fields for literature paper YAML:
  slug: string, title: string, created: string, updated: string, relevance: one of [core, related, peripheral]`;

  return "Read other YAML files of the same type in the same directory to see the expected structure.";
}

/**
 * Check if an error is a corrupt-file error (YAML or JSONL parse failure).
 * Returns a ToolResult with repair guidance including the expected schema.
 */
export function corruptFileResult(err: unknown): ToolResult | undefined {
  if (err instanceof YamlCorruptError) {
    const hint = schemaHint(err.filePath);
    return {
      title: "Corrupt YAML",
      output: [
        `File ${err.filePath} exists but cannot be parsed: ${err.parseError}`,
        "",
        "DO NOT call research_init or re-create the entity — that would overwrite existing data.",
        "To fix: use the Read tool to inspect the file, use the Edit tool to fix the YAML syntax error, then retry this operation.",
        "",
        hint,
      ].join("\n"),
      metadata: { error: "corrupt_yaml", filePath: err.filePath },
    };
  }
  if (err instanceof JsonlCorruptError) {
    return {
      title: "Corrupt JSONL",
      output: [
        `File ${err.filePath} has a corrupt entry at line ${err.line}: ${err.parseError}`,
        "",
        "To fix: use the Read tool to inspect the file, use the Edit tool to fix or remove the corrupt line (line ${err.line}), then retry this operation.",
        "Each line must be a valid JSON object. Check for unescaped quotes, trailing commas, or truncated lines.",
      ].join("\n"),
      metadata: { error: "corrupt_jsonl", filePath: err.filePath, line: err.line },
    };
  }
  // Handle file system errors
  if (err instanceof Error && "code" in err) {
    const code = (err as Error & { code?: string }).code;
    if (code === "ENOENT") {
      return {
        title: "File not found",
        output: `The requested file does not exist. It may have been deleted or the reference is stale.`,
        metadata: mdMeta({ error: "file_not_found" }),
      };
    }
    if (code === "EACCES") {
      return {
        title: "Permission denied",
        output: `Cannot access the requested file due to permission restrictions.`,
        metadata: mdMeta({ error: "permission_denied" }),
      };
    }
  }
  return undefined;
}

/**
 * Wrap a tool execute body so that YAML/JSONL corruption errors produce
 * actionable repair guidance instead of opaque failures.
 */
export async function withGuard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    const corrupt = corruptFileResult(err);
    if (corrupt) return corrupt;
    throw err;
  }
}

// ── Entity ID → directory mapping ────────────────────────────────────────────
// All entity .md paths are deterministic from the ID prefix.
// This is the single source of truth for that mapping.

export const ENTITY_DIRS: Record<string, string> = {
  idea: "ideas",
  plan: "plans",
  exp: "experiments",
  claim: "claims",
  exh: "exhibits",
  paper: "manuscripts",
  sub: "submissions",
};

/** Derive the entity type prefix from an ID (e.g. "idea_003" → "idea"). */
function entityPrefix(id: string): string | undefined {
  const idx = id.indexOf("_");
  return idx > 0 ? id.slice(0, idx) : undefined;
}

/** Return the relative .md path for an entity ID (e.g. ".research/ideas/idea_003.md"). */
export function entityMdPath(id: string): string {
  const prefix = entityPrefix(id);
  const dir = prefix ? ENTITY_DIRS[prefix] : undefined;
  if (!dir) {
    log.warn("entityMdPath", `Unknown entity prefix for ID "${id}", using fallback path`);
    return `.research/entities/${id}.md`;
  }
  return `.research/${dir}/${id}.md`;
}

// ── Append-only notes helper ─────────────────────────────────────────────────

/**
 * Append a timestamped section to an entity's .md file.
 * This preserves the research trail — content is never deleted, only added.
 *
 * audit#2 P1-17: distinguish ENOENT from other I/O errors. Previously the
 * blanket catch swallowed every read failure (permissions, EIO, etc.) and
 * overwrote the file with only the new section, destroying prior content.
 * Now only file-not-found falls through; other errors propagate.
 */
export async function appendNotes(dir: string, id: string, action: string, notes: string): Promise<void> {
  const mdPath = ResearchFS.resolve(dir, `${id}.md`);
  await withLock(mdMutex, async () => {
    let existing = "";
    try {
      existing = await Bun.file(mdPath).text();
    } catch (err) {
      const code = (err as { code?: string } | null | undefined)?.code;
      // Bun.file().text() on missing files throws an error whose .code may be
      // "ENOENT" or undefined depending on the underlying call. We treat
      // "missing" generously but rethrow on anything that smells like a real
      // I/O failure (EACCES, EIO, EBUSY, etc.).
      if (code && code !== "ENOENT") throw err;
    }
    const timestamp = new Date().toISOString().slice(0, 19) + "Z";
    const section = `\n\n---\n\n## ${action} — ${timestamp}\n\n${notes}\n`;
    await ResearchFS.writeMdUnlocked(mdPath, existing + section);
  });
}

/**
 * Build a lineage warning for missing fields on entity creation.
 * Returns empty string if all expected lineage is present.
 */
export function lineageWarning(entityType: string, params: Record<string, unknown>): string {
  const warnings: string[] = [];

  if (entityType === "experiment") {
    if (!params.plan_ref) warnings.push("plan");
    if (!params.idea_ref) warnings.push("idea");
  } else if (entityType === "plan") {
    if (!params.idea) warnings.push("idea");
  } else if (entityType === "claim") {
    if (!params.evidence || (Array.isArray(params.evidence) && params.evidence.length === 0)) {
      warnings.push("evidence");
    }
  }

  if (warnings.length === 0) return "";
  return `\n⚠️ Missing lineage: ${warnings.join(", ")} not specified. Add with update action for full traceability.`;
}

// ── Red-line helpers ─────────────────────────────────────────────────────────

const REDLINE_LABELS: Record<RedlineRule, string> = {
  R1_metric_immutability:
    "R1: Metric Immutability — eval metrics fixed at registration, never changed after seeing results",
  R2_eval_integrity: "R2: Eval Integrity — eval code changes trigger full re-run of ALL compared methods",
  R3_no_data_leakage: "R3: No Data Leakage — test data never influences training or hyperparameter selection",
  R4_honest_reporting: "R4: Honest Reporting — all metrics reported (mean±std across seeds), no cherry-picking",
  R5_dataset_integrity: "R5: Dataset Integrity — fixed train/val/test splits, identical for all compared methods",
  R6_reproducibility: "R6: Reproducibility — code, configs, seeds committed to git before experiment submission",
  R7_domain_constraints: "R7: Domain Constraints — domain-specific constraints declared at registration and verified",
};

/** Build the initial redline status object (all pending). */
export function initRedlineStatus(rules: RedlineRule[]): Record<RedlineRule, RedlineStatus> {
  const status: Record<string, RedlineStatus> = {};
  for (const r of rules) status[r] = "pending";
  return status as Record<RedlineRule, RedlineStatus>;
}

/** Check if all red-lines in an experiment have passed. */
export function allRedlinesPassed(redlines: ExperimentRedline): boolean {
  for (const rule of redlines.rules) {
    if (redlines.status[rule] !== "passed" && redlines.status[rule] !== "waived") {
      return false;
    }
  }
  return true;
}

/** Format red-line status for tool output. */
export function formatRedlineStatus(redlines: ExperimentRedline): string {
  const lines: string[] = [];
  for (const rule of redlines.rules) {
    const status = redlines.status[rule];
    const icon =
      status === "passed"
        ? "✅"
        : status === "violated"
          ? "❌"
          : status === "flagged"
            ? "⚠️"
            : status === "waived"
              ? "⚪"
              : "⏳";
    lines.push(`${icon} ${REDLINE_LABELS[rule]}`);
  }
  if (redlines.domain_constraints?.length) {
    lines.push("");
    lines.push("Domain constraints:");
    for (const c of redlines.domain_constraints) lines.push(`  - ${c}`);
  }
  return lines.join("\n");
}

// ── Evidence authenticity helpers ────────────────────────────────────────────

const AUTHENTICITY_LABELS: Record<EvidenceAuthenticity, string> = {
  prototype:
    "Prototype — synthetic data, homemade evaluator, or toy subset. For debugging only. Cannot support claims.",
  pilot: "Pilot — real data at reduced scale. For direction validation. Cannot support claims.",
  evidence: "Evidence — full benchmark, official evaluator, complete scale. Can support claims.",
};

export function validateAuthenticity(authenticity: EvidenceAuthenticity | undefined, action: string): string | null {
  if (action === "complete" && authenticity === "prototype") {
    return "Cannot mark a prototype as complete. Prototypes are for debugging. Register as pilot or evidence for publishable results.";
  }
  if (action === "claim_support" && authenticity && authenticity !== "evidence") {
    return `Cannot use a ${authenticity}-grade experiment as claim evidence. Only evidence-grade experiments (full benchmark, official evaluator, complete scale) can support claims.`;
  }
  return null;
}

export function formatAuthenticity(authenticity: EvidenceAuthenticity | undefined): string {
  const level = authenticity ?? "evidence";
  return AUTHENTICITY_LABELS[level];
}

// ── Terminal-state detection ────────────────────────────────────────────────

/**
 * Detect whether a status transition leaves a terminal state.
 * A terminal state is one with no allowed outgoing transitions.
 * Returns true when `fromStatus` is terminal (empty allowed list) and the
 * transition actually changes the status.
 */
export function isTerminalTransition(
  fromStatus: string,
  toStatus: string,
  transitionsTable: Record<string, string[]>,
): boolean {
  const allowed = transitionsTable[fromStatus] ?? [];
  return allowed.length === 0 && fromStatus !== toStatus;
}
