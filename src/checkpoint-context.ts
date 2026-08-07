import { ResearchFS } from "./fs";
import { loadAllYaml, loadDiagnosisReports, resolveFocusRefs } from "./helpers";
import { ResearchJournal } from "./journal";
import { PhaseRunManager } from "./phase-run";
import type {
  ClaimYaml,
  DiagnosisReport,
  ExperimentYaml,
  IdeaYaml,
  JournalNote,
  PhaseRun,
  PlanYaml,
  RQGReport,
  StateYaml,
  StorySpine,
  TimelineEvent,
} from "./schema";
import { SnapshotManager } from "./snapshot";
import { ResearchTimeline } from "./timeline";

// ---------------------------------------------------------------------------
// Types: Checkpoint Context & Brief
// ---------------------------------------------------------------------------

export interface CheckpointContext {
  // Identity
  project: string;
  anchor: string | null;
  venue: string | null;
  generatedAt: string;

  // Checkpoint identity
  checkpointKind: string;
  checkpointQuestion: string;
  phaseRunId: string;
  currentPhase: string;

  // Time window: since last checkpoint of same kind (or project start)
  sinceTimestamp: string | null;
  sinceLabel: string;

  // ── Section 1: What Happened ────────────────────────────────────────────

  /** Timeline events since the time window start, filtered to relevant ones */
  timelineEvents: TimelineEvent[];

  /** Journal notes in the time window */
  journalNotes: JournalNote[];

  /** Human decisions in the time window */
  humanDecisions: JournalNote[];

  /** Snapshots taken in the time window */
  snapshots: Array<{ id: string; trigger: string; summary: string; created: string }>;

  // ── Section 2: Current State ────────────────────────────────────────────

  /** Current phase run with inner loop state */
  phaseRun: PhaseRun | undefined;

  /** Inner loop summary for quick reading */
  innerLoopSummary: {
    state: string;
    round: number;
    attempts: number;
    stagnationRounds: number;
    lastDecision: string | null;
    progressMetric: { name: string; previous: number | null; current: number | null } | null;
    budget: { maxAttempts: number; maxStagnation: number } | null;
  };

  /** Focus refs: what entities are in play */
  focusRefs: {
    idea?: string;
    plan?: string;
    experiments: string[];
    claims: string[];
    exhibits: string[];
    paper?: string;
    submission?: string;
  };

  // ── Section 3: Entity Snapshots ─────────────────────────────────────────

  /** The selected idea (if in focus) */
  ideaDetails: IdeaYaml | null;

  /** The active plan (if in focus) */
  planDetails: PlanYaml | null;

  /** Experiments in focus with key info */
  experimentSummaries: Array<{
    id: string;
    title: string;
    status: string;
    group?: string;
    metrics?: Record<string, unknown>;
    keyFindings?: string;
  }>;

  /** Claims in focus with evidence */
  claimSummaries: Array<{
    id: string;
    title: string;
    status: string;
    statement?: string;
    evidenceCount: number;
    caveats: string[];
  }>;

  // ── Section 4: Story & RQG ──────────────────────────────────────────────

  /** StorySpine for the current idea (if any) */
  storySpine: StorySpine | null;

  /** RQG reports in scope */
  rqgReports: Array<{
    id: string;
    overall: string;
    killSetPassed: number;
    killSetTotal: number;
    sufficientSetPassed: number;
    sufficientSetTotal: number;
  }>;

  /** Latest diagnosis report (if any) */
  latestDiagnosis: DiagnosisReport | null;

  // ── Section 5: Decision Context ─────────────────────────────────────────

  /** Previous checkpoint decisions of the same kind */
  previousCheckpointHistory: Array<{
    decision: string;
    rationale?: string;
    date: string;
  }>;

  /** Entity counters for quick overview */
  entityCounters: StateYaml["counters"];
}

export interface CheckpointBrief {
  /** Unique ID for this brief */
  id: string;
  /** When this brief was generated */
  generatedAt: string;
  /** Path to the brief markdown file */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Data Aggregation
// ---------------------------------------------------------------------------

/** Find the timestamp of the last confirmed/waived checkpoint of a given kind */
function findLastCheckpointTime(allRuns: PhaseRun[], checkpointKind: string): string | null {
  const relevantCheckpoints = allRuns.flatMap((r) =>
    r.human_checkpoints
      .filter((cp) => cp.kind === checkpointKind && cp.status !== "pending" && cp.updated)
      .map((cp) => ({
        decision: cp.decision ?? "waived",
        rationale: cp.rationale ?? cp.waived_reason,
        date: cp.updated!,
      })),
  );

  if (relevantCheckpoints.length === 0) return null;
  // Return the most recent one
  relevantCheckpoints.sort((a, b) => b.date.localeCompare(a.date));
  return relevantCheckpoints[0]!.date;
}

/** Collect all data sources into a structured context object */
export async function gatherCheckpointContext(params: {
  phaseRunId: string;
  checkpointKind: string;
  checkpointQuestion: string;
}): Promise<CheckpointContext | null> {
  const { phaseRunId, checkpointKind, checkpointQuestion } = params;

  // Load global state
  const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
  if (!state) return null;

  const currentPhase = state.focus?.phase ?? "explore";
  const generatedAt = new Date().toISOString();

  // Cache all phase runs (used for checkpoint history and time window)
  const allPhaseRuns = await PhaseRunManager.list();

  // Find time window
  const sinceTimestamp = findLastCheckpointTime(allPhaseRuns, checkpointKind);
  const sinceLabel = sinceTimestamp
    ? new Date(sinceTimestamp).toLocaleString()
    : "(project start — first checkpoint of this kind)";

  // ── Parallel data loading ─────────────────────────────────────────────

  const [
    timelineEvents,
    journalNotes,
    humanDecisions,
    snapshots,
    phaseRun,
    allIdeas,
    allPlans,
    allExperiments,
    allClaims,
    storySpines,
    rqgReports,
    diagnosisReports,
  ] = await Promise.all([
    // Timeline since last checkpoint (or all if first)
    ResearchTimeline.query({ since: sinceTimestamp ?? undefined }),

    // Journal notes (fetch a generous window; filtered by sinceTimestamp below)
    ResearchJournal.queryNotes({ last: 500 }),

    // Human decisions (fetch a generous window; filtered by sinceTimestamp below)
    ResearchJournal.queryHumanDecisions({ last: 200 }),

    // Snapshots
    SnapshotManager.list(),

    // Current phase run
    PhaseRunManager.read(phaseRunId),

    // Entity data (parallel)
    loadAllYaml<IdeaYaml>("ideas"),
    loadAllYaml<PlanYaml>("plans"),
    loadAllYaml<ExperimentYaml>("experiments"),
    loadAllYaml<ClaimYaml>("claims"),
    loadAllYaml<StorySpine>("positioning", (f) => f.endsWith(".story.yaml")),
    loadAllYaml<RQGReport>("rqg"),
    // Load diagnoses from diagnoses/diag_*.yaml
    loadDiagnosisReports(),
  ]);

  // ── Resolve focus refs ────────────────────────────────────────────────

  const mergedRefs = resolveFocusRefs(
    state.focus?.refs as Record<string, string | string[] | undefined> | undefined,
    phaseRun?.refs as Record<string, string | string[] | undefined> | undefined,
  );
  const focusRefs = {
    idea: mergedRefs.idea_ref as string | undefined,
    plan: mergedRefs.plan_ref as string | undefined,
    experiments: (mergedRefs.experiment_refs as string[] | undefined) ?? [],
    claims: (mergedRefs.claim_refs as string[] | undefined) ?? [],
    exhibits: (mergedRefs.exhibit_refs as string[] | undefined) ?? [],
    paper: mergedRefs.paper_ref as string | undefined,
    submission: mergedRefs.submission_ref as string | undefined,
  };

  // ── Build entity summaries ────────────────────────────────────────────

  const ideaDetails = focusRefs.idea ? (allIdeas.find((i) => i.id === focusRefs.idea) ?? null) : null;

  const planDetails = focusRefs.plan ? (allPlans.find((p) => p.id === focusRefs.plan) ?? null) : null;

  const experimentSummaries = allExperiments
    .filter((e) => focusRefs.experiments.includes(e.id))
    .map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      group: e.group,
      metrics: e.metrics,
      keyFindings: e.description ?? e.failure_reason ?? "",
    }));

  const claimSummaries = allClaims
    .filter((c) => focusRefs.claims.includes(c.id))
    .map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      statement: c.statement,
      evidenceCount: c.evidence?.length ?? 0,
      caveats: c.caveats ?? [],
    }));

  // ── Story spine ───────────────────────────────────────────────────────

  const storySpine = focusRefs.idea ? (storySpines.find((s) => s.idea_ref === focusRefs.idea) ?? null) : null;

  // ── RQG & Diagnosis ───────────────────────────────────────────────────

  const rqgSummaries = rqgReports.map((r) => ({
    id: r.id,
    overall: r.overall,
    killSetPassed: r.kill_set.filter((k) => k.passed).length,
    killSetTotal: r.kill_set.length,
    sufficientSetPassed: r.sufficient_set.filter((s) => s.passed).length,
    sufficientSetTotal: r.sufficient_set.length,
  }));

  const latestDiagnosis = diagnosisReports.length > 0 ? diagnosisReports[diagnosisReports.length - 1]! : null;

  // ── Inner loop summary ────────────────────────────────────────────────

  const il = phaseRun?.inner_loop;
  const innerLoopSummary = {
    state: il?.state ?? "attempt",
    round: il?.round ?? 1,
    attempts: il?.attempts ?? 0,
    stagnationRounds: il?.stagnation_rounds ?? 0,
    lastDecision: il?.last_decision ?? null,
    progressMetric: il?.progress_metric
      ? {
          name: il.progress_metric.name,
          previous: il.progress_metric.previous ?? null,
          current: il.progress_metric.current ?? null,
        }
      : null,
    budget: il?.budget ? { maxAttempts: il.budget.max_attempts, maxStagnation: il.budget.max_stagnation } : null,
  };

  // ── Previous checkpoint history ───────────────────────────────────────

  const previousCheckpointHistory = allPhaseRuns.flatMap((r) =>
    r.human_checkpoints
      .filter((cp) => cp.kind === checkpointKind && cp.status !== "pending" && cp.decision)
      .map((cp) => ({
        decision: cp.decision!,
        rationale: cp.rationale,
        date: cp.updated ?? cp.created ?? "",
      })),
  );

  // ── Filter timeline/journal to time window ────────────────────────────

  const filteredTimeline = sinceTimestamp ? timelineEvents.filter((e) => e.ts >= sinceTimestamp) : timelineEvents;

  const filteredJournal = sinceTimestamp ? journalNotes.filter((n) => n.ts >= sinceTimestamp) : journalNotes;

  const filteredDecisions = sinceTimestamp ? humanDecisions.filter((d) => d.ts >= sinceTimestamp) : humanDecisions;

  const filteredSnapshots = sinceTimestamp ? snapshots.filter((s) => s.created >= sinceTimestamp) : snapshots;

  return {
    project: state.project,
    anchor: state.anchor ?? null,
    venue: state.config.venue ?? null,
    generatedAt,

    checkpointKind,
    checkpointQuestion,
    phaseRunId,
    currentPhase,

    sinceTimestamp,
    sinceLabel,

    timelineEvents: filteredTimeline,
    journalNotes: filteredJournal,
    humanDecisions: filteredDecisions,
    snapshots: filteredSnapshots.map((s) => ({
      id: s.id,
      trigger: s.trigger,
      summary: s.summary,
      created: s.created,
    })),

    phaseRun: phaseRun,
    innerLoopSummary,
    focusRefs,

    ideaDetails,
    planDetails,
    experimentSummaries,
    claimSummaries,

    storySpine,
    rqgReports: rqgSummaries,
    latestDiagnosis,

    previousCheckpointHistory,
    entityCounters: state.counters,
  };
}

// ---------------------------------------------------------------------------
// Markdown Brief Generation
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function fmtDateShort(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

// ---------------------------------------------------------------------------
// Section formatters
// ---------------------------------------------------------------------------

function formatHeader(ctx: CheckpointContext): string {
  const lines: string[] = [];
  lines.push(`# Human Checkpoint Brief`);
  lines.push("");
  lines.push(`**Project**: ${ctx.project}`);
  if (ctx.anchor) lines.push(`**Anchor**: ${ctx.anchor}`);
  if (ctx.venue) lines.push(`**Venue**: ${ctx.venue}`);
  lines.push(`**Phase**: ${ctx.currentPhase}`);
  lines.push(`**Checkpoint**: ${ctx.checkpointKind}`);
  lines.push(`**Generated**: ${fmtDate(ctx.generatedAt)}`);
  lines.push("");
  return lines.join("\n");
}

function formatDecisionRequired(ctx: CheckpointContext): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("## 🎯 Decision Required");
  lines.push("");
  lines.push(ctx.checkpointQuestion);
  lines.push("");
  if (ctx.phaseRun?.human_checkpoints) {
    const pending = ctx.phaseRun.human_checkpoints.filter((cp) => cp.status === "pending");
    if (pending.length > 0) {
      lines.push("### Pending Checkpoints");
      lines.push("");
      for (const cp of pending) {
        lines.push(`- **[${cp.kind}]** ${cp.question ?? "No question"}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function formatWhatHappened(ctx: CheckpointContext): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("## 📋 What Happened Since Last Checkpoint");
  lines.push("");
  lines.push(`Time window: ${ctx.sinceLabel} → now`);
  lines.push("");

  // Timeline summary
  if (ctx.timelineEvents.length === 0) {
    lines.push("*No timeline events in this window.*");
  } else {
    lines.push(`### Timeline (${ctx.timelineEvents.length} events)`);
    lines.push("");

    // Group events by type for readability
    const eventsByType = new Map<string, TimelineEvent[]>();
    for (const ev of ctx.timelineEvents) {
      const group = ev.type.split(".")[0]!; // e.g., "idea" from "idea.created"
      if (!eventsByType.has(group)) eventsByType.set(group, []);
      eventsByType.get(group)!.push(ev);
    }

    // Show high-level summary first
    const significantEvents = ctx.timelineEvents.filter(
      (e) =>
        e.level === "decision" ||
        e.level === "gate" ||
        e.level === "pivot" ||
        e.level === "critical" ||
        e.type === "focus.changed" ||
        e.type === "milestone" ||
        e.type === "decision",
    );

    if (significantEvents.length > 0) {
      lines.push("**Key Events:**");
      lines.push("");
      for (const ev of significantEvents) {
        const id = ev.id ? ` (${ev.id})` : "";
        lines.push(`- \`${fmtDateShort(ev.ts)}\` **${ev.type}**${id}: ${ev.summary ?? ev.type}`);
      }
      lines.push("");
    }

    // Show event type distribution
    lines.push("<details>");
    lines.push("<summary>All events by category</summary>");
    lines.push("");
    for (const [group, events] of eventsByType) {
      lines.push(`**${group}** (${events.length})`);
      for (const ev of events.slice(0, 10)) {
        const id = ev.id ? ` (${ev.id})` : "";
        lines.push(`- \`${fmtDateShort(ev.ts)}\` ${ev.type}${id}: ${ev.summary ?? ""}`);
      }
      if (events.length > 10) {
        lines.push(`  ... and ${events.length - 10} more`);
      }
      lines.push("");
    }
    lines.push("</details>");
    lines.push("");
  }

  // Journal notes
  if (ctx.journalNotes.length > 0) {
    lines.push(`### Research Notes (${ctx.journalNotes.length})`);
    lines.push("");
    // Show important/critical notes
    const importantNotes = ctx.journalNotes.filter((n) => n.importance === "important" || n.importance === "critical");
    if (importantNotes.length > 0) {
      for (const note of importantNotes) {
        lines.push(`**[${note.importance}]** ${note.summary} (_${fmtDateShort(note.ts)}_)`);
        if (note.note.length > 200) {
          lines.push(`> ${note.note.slice(0, 200)}...`);
        } else {
          lines.push(`> ${note.note}`);
        }
        lines.push("");
      }
    }

    lines.push("<details>");
    lines.push("<summary>All research notes</summary>");
    lines.push("");
    for (const note of ctx.journalNotes) {
      lines.push(`**${note.id}** [${note.kind}] ${note.summary} (_${fmtDateShort(note.ts)}_)`);
      lines.push(`> ${note.note}`);
      lines.push("");
    }
    lines.push("</details>");
    lines.push("");
  }

  // Human decisions
  if (ctx.humanDecisions.length > 0) {
    lines.push(`### Previous Human Decisions (${ctx.humanDecisions.length})`);
    lines.push("");
    for (const d of ctx.humanDecisions) {
      lines.push(`- \`${fmtDateShort(d.ts)}\` **${d.kind}**: ${d.summary}`);
      if (d.note) {
        lines.push(`  > ${d.note.slice(0, 150)}${d.note.length > 150 ? "..." : ""}`);
      }
    }
    lines.push("");
  }

  // Snapshots
  if (ctx.snapshots.length > 0) {
    lines.push(`### Snapshots (${ctx.snapshots.length})`);
    lines.push("");
    for (const snap of ctx.snapshots) {
      lines.push(`- \`${fmtDateShort(snap.created)}\` [${snap.trigger}]: ${snap.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatCurrentState(ctx: CheckpointContext): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("## 📊 Current State");
  lines.push("");

  // Inner loop
  const il = ctx.innerLoopSummary;
  lines.push("### Inner Loop");
  lines.push("");
  lines.push(`- **State**: ${il.state}`);
  lines.push(`- **Round**: ${il.round}`);
  lines.push(`- **Attempts**: ${il.attempts}`);
  lines.push(`- **Stagnation**: ${il.stagnationRounds} rounds`);
  if (il.lastDecision) lines.push(`- **Last Decision**: ${il.lastDecision}`);
  if (il.progressMetric) {
    lines.push(
      `- **Progress**: ${il.progressMetric.name} = ${il.progressMetric.current ?? "?"} (was: ${il.progressMetric.previous ?? "?"})`,
    );
  }
  if (il.budget) {
    lines.push(`- **Budget**: max ${il.budget.maxAttempts} attempts, max ${il.budget.maxStagnation} stagnation`);
  }
  lines.push("");

  // Entity counters
  lines.push("### Entity Overview");
  lines.push("");
  const c = ctx.entityCounters;
  lines.push(`| Type | Count | In Focus |`);
  lines.push(`|------|-------|----------|`);
  lines.push(`| Ideas | ${c.idea} | ${ctx.focusRefs.idea ?? "—"} |`);
  lines.push(`| Plans | ${c.plan} | ${ctx.focusRefs.plan ?? "—"} |`);
  lines.push(
    `| Experiments | ${c.exp} | ${ctx.focusRefs.experiments.length > 0 ? ctx.focusRefs.experiments.join(", ") : "—"} |`,
  );
  lines.push(`| Claims | ${c.claim} | ${ctx.focusRefs.claims.length > 0 ? ctx.focusRefs.claims.join(", ") : "—"} |`);
  lines.push(
    `| Exhibits | ${c.exh} | ${ctx.focusRefs.exhibits.length > 0 ? ctx.focusRefs.exhibits.join(", ") : "—"} |`,
  );
  lines.push(`| Papers | ${c.paper} | ${ctx.focusRefs.paper ?? "—"} |`);
  lines.push(`| Submissions | ${c.sub} | ${ctx.focusRefs.submission ?? "—"} |`);
  lines.push("");

  return lines.join("\n");
}

function formatKeyEntities(ctx: CheckpointContext): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("## 🔬 Key Entities in Focus");
  lines.push("");

  // Idea
  if (ctx.ideaDetails) {
    lines.push("### Selected Idea");
    lines.push("");
    lines.push(`**${ctx.ideaDetails.id}**: ${ctx.ideaDetails.title}`);
    lines.push(`- Status: ${ctx.ideaDetails.status}`);
    lines.push(`- Round: ${ctx.ideaDetails.round}`);
    if (ctx.ideaDetails.derived_from?.length) {
      lines.push(`- Derived from: ${ctx.ideaDetails.derived_from.join(", ")}`);
    }
    if (ctx.ideaDetails.selected_by) {
      lines.push(`- Selected by: ${ctx.ideaDetails.selected_by}`);
    }
    lines.push("");
  }

  // Plan
  if (ctx.planDetails) {
    lines.push("### Active Plan");
    lines.push("");
    lines.push(`**${ctx.planDetails.id}**: ${ctx.planDetails.title}`);
    lines.push(`- Status: ${ctx.planDetails.status}`);
    if (ctx.planDetails.kill_set.length > 0) {
      lines.push(`- Kill criteria: ${ctx.planDetails.kill_set.length}`);
      for (const kc of ctx.planDetails.kill_set) {
        lines.push(
          `  - ${kc.id}: ${kc.metric} ${kc.direction} (baseline: ${kc.baseline_value ?? "?"}, target delta: ${kc.target_delta ?? "?"})`,
        );
      }
    }
    if (ctx.planDetails.sufficient_set.length > 0) {
      lines.push(`- Sufficient criteria: ${ctx.planDetails.sufficient_set.length}`);
      for (const sc of ctx.planDetails.sufficient_set) {
        lines.push(`  - ${sc.id}: ${sc.metric} ${sc.direction} (target: ${sc.target_value ?? "?"})`);
      }
    }
    lines.push("");
  }

  // Experiments
  if (ctx.experimentSummaries.length > 0) {
    lines.push("### Experiments");
    lines.push("");
    for (const exp of ctx.experimentSummaries) {
      lines.push(`**${exp.id}**: ${exp.title}`);
      lines.push(`- Status: ${exp.status}`);
      if (exp.group) lines.push(`- Group: ${exp.group}`);
      if (exp.metrics && Object.keys(exp.metrics).length > 0) {
        const metricStrs = Object.entries(exp.metrics)
          .slice(0, 5)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        lines.push(`- Metrics: ${metricStrs}`);
      }
      if (exp.keyFindings) lines.push(`- ⚠ ${exp.keyFindings}`);
      lines.push("");
    }
  }

  // Claims
  if (ctx.claimSummaries.length > 0) {
    lines.push("### Claims");
    lines.push("");
    for (const claim of ctx.claimSummaries) {
      lines.push(`**${claim.id}**: ${claim.title}`);
      lines.push(`- Status: ${claim.status}`);
      if (claim.statement) lines.push(`- Statement: ${claim.statement}`);
      lines.push(`- Evidence: ${claim.evidenceCount} items`);
      if (claim.caveats.length > 0) {
        lines.push(`- Caveats: ${claim.caveats.join("; ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatStoryAndRQG(ctx: CheckpointContext): string {
  const lines: string[] = [];

  if (ctx.storySpine) {
    lines.push("---");
    lines.push("");
    lines.push("## 📖 Story Spine");
    lines.push("");
    const s = ctx.storySpine;
    lines.push(`- **Field Assumption**: ${s.field_assumption}`);
    lines.push(`- **Pain Point**: ${s.pain_point}`);
    lines.push(`- **Non-obvious Insight**: ${s.non_obvious_insight}`);
    if (s.why_now) lines.push(`- **Why Now**: ${s.why_now}`);
    lines.push(`- **What Changes If True**: ${s.what_changes_if_true}`);
    if (s.beneficiaries.length > 0) {
      lines.push(`- **Beneficiaries**: ${s.beneficiaries.join(", ")}`);
    }
    if (s.candidate_paper_angles.length > 0) {
      lines.push("");
      lines.push("**Candidate Angles:**");
      for (const angle of s.candidate_paper_angles) {
        lines.push(`- [${angle.type}] ${angle.title_sketch}: ${angle.promise}`);
      }
    }
    if (s.story_risks.length > 0) {
      lines.push("");
      lines.push("**Risks:**");
      for (const risk of s.story_risks) {
        lines.push(`- ${risk}`);
      }
    }
    if (s.grounded_angle) {
      lines.push("");
      lines.push(`**Grounded Angle**: [${s.grounded_angle.type}] ${s.grounded_angle.title_sketch}`);
      lines.push(`- Thesis: ${s.grounded_angle.paper_thesis}`);
    }
    lines.push("");
  }

  if (ctx.rqgReports.length > 0) {
    lines.push("### Result Quality Gate");
    lines.push("");
    for (const rqg of ctx.rqgReports) {
      lines.push(
        `**${rqg.id}** — Overall: **${rqg.overall}** (Kill: ${rqg.killSetPassed}/${rqg.killSetTotal}, Sufficient: ${rqg.sufficientSetPassed}/${rqg.sufficientSetTotal})`,
      );
    }
    lines.push("");
  }

  if (ctx.latestDiagnosis) {
    lines.push("### Latest Diagnosis");
    lines.push("");
    const d = ctx.latestDiagnosis;
    const levels = d.levels;
    for (const [key, val] of Object.entries(levels)) {
      if (val) {
        lines.push(`- **${key}**: ${val.status}${val.evidence ? ` — ${val.evidence}` : ""}`);
        if (val.recommended_action) {
          lines.push(`  → ${val.recommended_action}`);
        }
      }
    }
    if (d.conclusion) {
      lines.push("");
      lines.push(`**Conclusion**: ${d.conclusion.likely_cause ?? "Unknown"}`);
      if (d.conclusion.recommended_decision) {
        lines.push(`**Recommended**: ${d.conclusion.recommended_decision}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatHistoryAndContext(ctx: CheckpointContext): string {
  const lines: string[] = [];

  if (ctx.previousCheckpointHistory.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## 📜 Previous Checkpoint Decisions (Same Kind)");
    lines.push("");
    for (const hist of ctx.previousCheckpointHistory) {
      lines.push(`- \`${fmtDateShort(hist.date)}\` **${hist.decision}**`);
      if (hist.rationale) lines.push(`  > ${hist.rationale}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatConsiderations(ctx: CheckpointContext): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("## 💡 What to Consider");
  lines.push("");
  lines.push(generateConsiderations(ctx));
  lines.push("");
  return lines.join("\n");
}

function formatFooter(ctx: CheckpointContext): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push(`_Brief generated at ${fmtDate(ctx.generatedAt)} by AutoResearch v2.1_`);
  lines.push(`_Phase Run: ${ctx.phaseRunId}_`);
  lines.push("");
  return lines.join("\n");
}

/** Generate a human-readable Markdown brief from the context */
export function generateMarkdownBrief(ctx: CheckpointContext): string {
  return [
    formatHeader(ctx),
    formatDecisionRequired(ctx),
    formatWhatHappened(ctx),
    formatCurrentState(ctx),
    formatKeyEntities(ctx),
    formatStoryAndRQG(ctx),
    formatHistoryAndContext(ctx),
    formatConsiderations(ctx),
    formatFooter(ctx),
  ].join("\n");
}

/** Generate contextual considerations based on checkpoint kind */
function generateConsiderations(ctx: CheckpointContext): string {
  const lines: string[] = [];

  switch (ctx.checkpointKind) {
    case "taste_selection": {
      if (ctx.ideaDetails) {
        lines.push(`The idea "${ctx.ideaDetails.title}" was selected from ${ctx.entityCounters.idea} candidates.`);
      }
      if (ctx.storySpine) {
        lines.push("");
        lines.push("**Story alignment questions:**");
        lines.push(`- Does the pain point ("${ctx.storySpine.pain_point}") resonate with the community?`);
        lines.push(`- Is the insight ("${ctx.storySpine.non_obvious_insight}") genuinely non-obvious?`);
        if (ctx.storySpine.story_risks.length > 0) {
          lines.push(`- Key risks: ${ctx.storySpine.story_risks.join("; ")}`);
        }
      }
      lines.push("");
      lines.push("**Options:**");
      lines.push("1. **Confirm** — Proceed with this selection");
      lines.push("2. **Request alternative** — Go back and explore other candidates");
      lines.push("3. **Refine** — Ask for more grounding before committing");
      break;
    }

    case "reasonableness_check": {
      if (ctx.planDetails) {
        lines.push(
          `The plan "${ctx.planDetails.title}" defines ${ctx.planDetails.kill_set.length} kill criteria and ${ctx.planDetails.sufficient_set.length} sufficient criteria.`,
        );
      }
      if (ctx.experimentSummaries.length > 0) {
        const running = ctx.experimentSummaries.filter((e) => e.status === "running").length;
        const completed = ctx.experimentSummaries.filter((e) => e.status === "completed").length;
        lines.push(
          `Current experiments: ${completed} completed, ${running} running, ${ctx.experimentSummaries.length} total in focus.`,
        );
      }
      lines.push("");
      lines.push("**Options:**");
      lines.push("1. **Confirm** — Mechanism is reasonable, proceed");
      lines.push("2. **Request revision** — Needs more thought before proceeding");
      lines.push("3. **Pivot** — Wrong direction, need fundamental change");
      break;
    }

    case "resource_commitment": {
      const rc = ctx.phaseRun?.human_checkpoints.find(
        (cp) => cp.kind === "resource_commitment" && cp.status === "pending",
      )?.resource_commitment;
      if (rc) {
        const isPlaceholder = rc.resource_spec.gpu_type === "OTHER";
        if (isPlaceholder) {
          lines.push(`**⚠️ Resource spec is a PLACEHOLDER — you MUST provide the actual configuration.**`);
          lines.push(`The default values below do not reflect your real compute environment.`);
        }
        lines.push(`**Current resource spec:**`);
        lines.push(`- GPU: ${rc.resource_spec.gpu_type} × ${rc.resource_spec.gpu_count}`);
        lines.push(`- Nodes: ${rc.resource_spec.nodes}`);
        lines.push(`- Estimated hours: ${rc.resource_spec.estimated_gpu_hours ?? "not specified"}`);
        lines.push(`- Connection: ${rc.connection_method ?? "not specified"}`);
      }
      lines.push("");
      lines.push("**Options:**");
      lines.push(
        "1. **Approve with real spec** — Confirm with the ACTUAL resource_commitment (you MUST provide the real GPU type, count, and connection_method)",
      );
      lines.push("2. **Adjust** — Modify GPU type, count, or connection method before approving");
      lines.push("3. **Defer** — Not ready to commit resources yet");
      lines.push("");
      lines.push(
        "⚠️ Do NOT blindly approve placeholder values. You must provide a `resource_commitment` parameter with the real compute configuration when confirming.",
      );
      break;
    }

    case "paper_ambition": {
      if (ctx.claimSummaries.length > 0) {
        const supported = ctx.claimSummaries.filter((c) => c.status === "supported" || c.status === "final").length;
        const weak = ctx.claimSummaries.filter((c) => c.status === "weak" || c.status === "candidate").length;
        lines.push(
          `Claims status: ${supported} supported/final, ${weak} weak/candidate, ${ctx.claimSummaries.length} total.`,
        );
      }
      if (ctx.rqgReports.length > 0) {
        const passed = ctx.rqgReports.filter((r) => r.overall === "passed").length;
        lines.push(`RQG: ${passed}/${ctx.rqgReports.length} reports passed.`);
      }
      lines.push("");
      lines.push("**Options:**");
      lines.push("1. **Confirm** — Results support the intended paper ambition");
      lines.push("2. **Scale back** — Results are partial, need to adjust ambition");
      lines.push("3. **Request more experiments** — Evidence is insufficient");
      break;
    }

    case "pivot_confirmation": {
      if (ctx.latestDiagnosis?.conclusion) {
        lines.push(`**Diagnosis conclusion**: ${ctx.latestDiagnosis.conclusion.likely_cause ?? "Unknown"}`);
        lines.push(`**Recommended decision**: ${ctx.latestDiagnosis.conclusion.recommended_decision ?? "N/A"}`);
      }
      lines.push("");
      lines.push("**Options:**");
      lines.push("1. **Confirm pivot** — Agree with the proposed direction change");
      lines.push("2. **Try one more iteration** — Give the current approach another chance");
      lines.push("3. **Abort** — Stop this line of research entirely");
      break;
    }

    case "submission_readiness": {
      lines.push("Review all claims, evidence, and paper sections before confirming submission readiness.");
      lines.push("");
      lines.push("**Options:**");
      lines.push("1. **Ready to submit** — All sections finalized, claims supported");
      lines.push("2. **Need revisions** — Specific sections need work");
      lines.push("3. **Not ready** — Significant gaps remain");
      break;
    }

    default: {
      lines.push("Review the context above and make a decision on the pending checkpoint.");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Brief Persistence
// ---------------------------------------------------------------------------

/** Generate and persist a checkpoint brief, returning metadata */
export async function generateAndSaveBrief(params: {
  phaseRunId: string;
  checkpointKind: string;
  checkpointQuestion: string;
}): Promise<CheckpointBrief | null> {
  const context = await gatherCheckpointContext(params);
  if (!context) return null;

  const markdown = generateMarkdownBrief(context);

  const id = `brief_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const fileName = `${id}.md`;
  const dir = "checkpoint_briefs";

  const filePath = ResearchFS.resolve(dir, fileName);
  await ResearchFS.ensureDir(ResearchFS.resolve(dir));
  await ResearchFS.writeMd(filePath, markdown);

  return {
    id,
    generatedAt: context.generatedAt,
    filePath: `${dir}/${fileName}`,
  };
}

/** Read a previously generated brief */
export async function readBrief(filePath: string): Promise<string | undefined> {
  return ResearchFS.readMd(ResearchFS.resolve(filePath));
}
