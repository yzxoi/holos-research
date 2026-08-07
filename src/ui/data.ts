import {
  PHASE_DESCRIPTIONS,
  PHASE_DISPLAY_NAMES,
  PHASE_KEY_QUESTIONS,
  PHASE_ORDER,
  PHASE_PIVOT_TARGETS,
  PHASE_PROMOTE_CRITERIA,
  STATIC_PIVOT_EDGES,
} from "./constants";
import type {
  ApiDiagnosisReport,
  ApiEntityRecord,
  ApiHumanCheckpoint,
  ApiJournalNote,
  ApiResponse,
  ApiRQGReport,
  ApiRun,
  ApiStorySpine,
  ApiTimelineEvent,
  ApiWorkflowPhase,
  Entity,
  EntityKind,
  EntityStatus,
  EntitySummaryData,
  HumanCheckpoint,
  InnerLoopState,
  JournalEntry,
  MonitorData,
  PhaseInfo,
  PhaseName,
  PhaseRun,
  PhaseRunCard,
  PhaseStatus,
  PivotEdge,
  TimelineEvent,
} from "./types";

const VALID_PHASES = new Set<string>(PHASE_ORDER);

function safePhaseName(value: string | null | undefined): PhaseName {
  if (value && VALID_PHASES.has(value)) return value as PhaseName;
  return "explore";
}

function safeCast<T extends string>(value: string | undefined, validValues: readonly T[], fallback: T): T {
  if (value && (validValues as readonly string[]).includes(value)) return value as T;
  return fallback;
}

const VALID_ENTITY_STATUSES: readonly EntityStatus[] = [
  "proposed",
  "exploring",
  "grounding",
  "selected",
  "parked",
  "rejected",
  "draft",
  "active",
  "superseded",
  "approved",
  "dropped",
  "stopped",
  "registered",
  "scheduled",
  "running",
  "completed",
  "failed",
  "invalidated",
  "candidate",
  "supported",
  "qualified",
  "weak",
  "retracted",
  "final",
  "outlined",
  "drafting",
  "revising",
  "ready",
  "frozen",
  "verified",
  "submitted",
  "under_review",
  "rebuttal",
  "revision_requested",
  "resubmitted",
  "accepted",
  "closed",
  "preparing",
  "archived",
  "unknown",
];

const VALID_CHECKPOINT_STATUSES = ["pending", "confirmed", "waived"] as const;
const VALID_GPU_TYPES = ["A100", "A100-80G", "H100", "H200", "RTX-4090", "RTX-3090", "V100", "T4", "OTHER"] as const;
const VALID_CONNECTION_METHODS = ["rtunnel", "holos-inspire", "inspire", "local", "api", "manual"] as const;
const VALID_STORY_STATUSES = ["proposed", "exploring", "grounding", "selected", "parked", "rejected"] as const;
const VALID_RQG_OVERALL = ["passed", "partial", "failed", "invalid"] as const;
const VALID_DIAGNOSIS_LEVEL_STATUSES = ["pass", "warning", "fail", "skip", "pending"] as const;
const VALID_TIMELINE_LEVELS = ["trace", "info", "decision", "gate", "pivot", "human", "critical"] as const;
const VALID_JOURNAL_IMPORTANCE = ["critical", "important", "normal"] as const;
const VALID_ENTITY_KINDS = ["idea", "plan", "experiment", "claim", "exhibit", "paper", "submission"] as const;

const VALID_INNER_LOOP_STATES: readonly InnerLoopState[] = [
  "attempt",
  "evaluate",
  "decide",
  "blocked",
  "promoted",
  "pivoted",
  "aborted",
];

const VALID_PHASE_RUN_STATUSES: readonly PhaseRun["status"][] = ["active", "promoted", "pivoted", "aborted", "blocked"];

function computePhaseStatus(phase: PhaseName, currentPhase: PhaseName): PhaseStatus {
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  if (phaseIdx < currentIdx) return "completed";
  if (phaseIdx === currentIdx) return "active";
  return "pending";
}

const ENTITY_MAPPINGS = {
  ideas: { kind: "idea" as EntityKind, phase: "explore" as PhaseName, display: "Ideas" },
  plans: { kind: "plan" as EntityKind, phase: "design" as PhaseName, display: "Plans" },
  experiments: { kind: "experiment" as EntityKind, phase: "experiment" as PhaseName, display: "Experiments" },
  claims: { kind: "claim" as EntityKind, phase: "compose" as PhaseName, display: "Claims" },
  exhibits: { kind: "exhibit" as EntityKind, phase: "compose" as PhaseName, display: "Exhibits" },
  papers: { kind: "paper" as EntityKind, phase: "compose" as PhaseName, display: "Papers" },
  submissions: { kind: "submission" as EntityKind, phase: "compose" as PhaseName, display: "Submissions" },
} as const;

const ENTITY_KEYS = Object.keys(ENTITY_MAPPINGS) as (keyof typeof ENTITY_MAPPINGS)[];

function mapApiCheckpoint(cp: ApiHumanCheckpoint): HumanCheckpoint {
  return {
    kind: cp.kind,
    status: safeCast(cp.status, VALID_CHECKPOINT_STATUSES, "pending"),
    question: cp.question,
    decision: cp.decision,
    rationale: cp.rationale,
    waivedReason: cp.waived_reason,
    briefRef: cp.brief_ref,
    briefGeneratedAt: cp.brief_generated_at,
    resourceCommitment: cp.resource_commitment
      ? {
          resourceSpec: {
            gpuType: safeCast(cp.resource_commitment.resource_spec?.gpu_type, VALID_GPU_TYPES, "OTHER"),
            gpuCount: cp.resource_commitment.resource_spec?.gpu_count ?? 1,
            nodes: cp.resource_commitment.resource_spec?.nodes ?? 1,
            cpuCount: cp.resource_commitment.resource_spec?.cpu_count,
            memoryGb: cp.resource_commitment.resource_spec?.memory_gb,
            estimatedGpuHours: cp.resource_commitment.resource_spec?.estimated_gpu_hours,
            timeoutHours: cp.resource_commitment.resource_spec?.timeout_hours,
            priority: cp.resource_commitment.resource_spec?.priority,
          },
          workspace: cp.resource_commitment.workspace,
          computeGroup: cp.resource_commitment.compute_group,
          image: cp.resource_commitment.image,
          connectionMethod: cp.resource_commitment.connection_method
            ? safeCast(cp.resource_commitment.connection_method, VALID_CONNECTION_METHODS, "local")
            : undefined,
          connectionUrl: cp.resource_commitment.connection_url,
          fallbackPlan: cp.resource_commitment.fallback_plan,
          budgetApproved: cp.resource_commitment.budget_approved ?? cp.status === "confirmed",
        }
      : undefined,
  };
}

function mapApiRun(apiRun: ApiRun, phase: PhaseName): PhaseRun {
  return {
    id: apiRun.id,
    phase,
    status: safeCast(apiRun.status, VALID_PHASE_RUN_STATUSES, "promoted"),
    created: apiRun.created,
    updated: apiRun.updated,
    innerLoop: {
      state: safeCast(apiRun.inner_loop?.state, VALID_INNER_LOOP_STATES, "attempt"),
      round: apiRun.inner_loop?.round ?? 1,
      attempts: apiRun.inner_loop?.attempts ?? 0,
      stagnationRounds: apiRun.inner_loop?.stagnation_rounds ?? 0,
      lastDecision: (apiRun.inner_loop?.last_decision ?? undefined) as PhaseRun["innerLoop"]["lastDecision"],
      maxAttempts: apiRun.inner_loop?.budget?.max_attempts ?? 6,
      maxStagnation: apiRun.inner_loop?.budget?.max_stagnation ?? 2,
      progressMetric: apiRun.inner_loop?.progress_metric
        ? {
            name: apiRun.inner_loop.progress_metric.name,
            current: apiRun.inner_loop.progress_metric.current ?? 0,
            previous: apiRun.inner_loop.progress_metric.previous ?? 0,
          }
        : undefined,
      summary: apiRun.inner_loop?.summary,
    },
    refs: (() => {
      const r = apiRun.refs;
      return {
        idea: r?.idea_ref,
        plan: r?.plan_ref,
        experiments: r?.experiment_refs,
        claims: r?.claim_refs,
        exhibits: r?.exhibit_refs,
        paper: r?.paper_ref,
        submission: r?.submission_ref,
      };
    })(),
    checkpoints: (apiRun.human_checkpoints ?? []).map(mapApiCheckpoint),
    pivot: apiRun.pivot
      ? {
          from: safePhaseName(apiRun.pivot.from),
          to: safePhaseName(apiRun.pivot.to),
          category: apiRun.pivot.category ?? "",
          rationale: apiRun.pivot.rationale ?? apiRun.pivot.reason ?? "",
          evidenceRefs: apiRun.pivot.evidence_refs ?? [],
        }
      : undefined,
  };
}

/** Transform the /api/all-shaped operation payload into the frontend MonitorData shape. */
export function buildMonitorData(api: ApiResponse): MonitorData {
  const workflow = api.workflow ?? {
    current_phase: null,
    current_phase_since: null,
    blocked_on: null,
    phases: [],
    anchor: null,
    project_summary: null,
    next: null,
  };
  const currentPhase: PhaseName = safePhaseName(workflow.current_phase);
  const entityData = api.entities;

  const phases: PhaseInfo[] = PHASE_ORDER.map((phase) => {
    const wfPhase = workflow.phases?.find((p: ApiWorkflowPhase) => p.name === phase);
    let status: PhaseStatus = wfPhase
      ? wfPhase.is_current
        ? "active"
        : wfPhase.is_completed
          ? "completed"
          : "pending"
      : computePhaseStatus(phase, currentPhase);
    if (status === "active" && workflow.blocked_on) {
      status = "blocked";
    }

    let run: PhaseRun | undefined;
    const activeRun = api.activeRun;

    if (status === "active" && activeRun?.run) {
      run = mapApiRun(activeRun.run, phase);
    } else if (status === "completed") {
      const pd = api.phaseDetailsMap?.[phase];
      if (pd) {
        const promotedRuns = pd.all_runs?.filter((r: ApiRun) => r.status === "promoted") ?? [];
        const primaryRun = promotedRuns.length > 0 ? promotedRuns[0] : pd.all_runs?.[pd.all_runs.length - 1];
        if (primaryRun) {
          run = mapApiRun(primaryRun, phase);
        }
        if (run && pd.all_runs && pd.all_runs.length > 1) {
          const existingKinds = new Set(run.checkpoints.map((cp) => cp.kind));
          const extraCheckpoints = pd.all_runs
            .flatMap((r: ApiRun) => (r.human_checkpoints ?? []).map(mapApiCheckpoint))
            .filter((cp) => !existingKinds.has(cp.kind));
          if (extraCheckpoints.length > 0) {
            run.checkpoints = [...run.checkpoints, ...extraCheckpoints];
          }
        }
      }
    }

    const entityCount = (api.entityRecords ?? []).filter((r: ApiEntityRecord) => r.phase === phase).length;

    const latestActivity = status === "active" && activeRun?.run?.updated ? activeRun.run.updated : undefined;
    const contextRefreshedAt =
      status !== "pending" && workflow.current_phase_since && status === "active"
        ? workflow.current_phase_since
        : undefined;

    return {
      name: phase,
      displayName: PHASE_DISPLAY_NAMES[phase],
      status,
      description: PHASE_DESCRIPTIONS[phase],
      keyQuestion: PHASE_KEY_QUESTIONS[phase],
      promoteCriteria: PHASE_PROMOTE_CRITERIA[phase],
      pivotTargets: PHASE_PIVOT_TARGETS[phase],
      entityCount,
      latestActivity,
      run,
      checkpoints: run?.checkpoints ?? [],
      contextRefreshedAt,
      focusRefs: status === "active" || status === "blocked" ? entityData?.focus_refs : undefined,
    };
  });

  const phaseDetailsMap = api.phaseDetailsMap ?? {};
  for (const p of phases) {
    const pd = phaseDetailsMap[p.name];
    if (!pd) continue;

    if (pd.stories && pd.stories.length > 0) {
      p.stories = pd.stories.map((s: ApiStorySpine) => ({
        id: s.id,
        ideaRef: s.idea_ref,
        status: safeCast(s.status, VALID_STORY_STATUSES, "proposed"),
        fieldAssumption: s.field_assumption,
        painPoint: s.pain_point,
        nonObviousInsight: s.non_obvious_insight,
        candidateAngles: (s.candidate_paper_angles ?? []).map((a) => ({
          type: a.type,
          titleSketch: a.title_sketch,
        })),
        scores: s.scores ?? {},
      }));
    }

    if (pd.rqg && pd.rqg.length > 0) {
      p.rqg = pd.rqg.map((r: ApiRQGReport) => ({
        id: r.id,
        overall: safeCast(r.overall, VALID_RQG_OVERALL, "failed"),
        killSetPassed: r.kill_set_passed,
        killSetTotal: r.kill_set_total,
        sufficientSetPassed: r.sufficient_set_passed,
        sufficientSetTotal: r.sufficient_set_total,
        allowedNext: r.allowed_next ?? [],
        disallowedNext: r.disallowed_next ?? [],
      }));
    }

    if (pd.diagnosis && pd.diagnosis.length > 0) {
      p.diagnosis = pd.diagnosis.map((d: ApiDiagnosisReport) => ({
        id: d.id,
        conclusion: d.conclusion,
        pivotRoute: d.pivot_route,
        levels: (d.levels ?? []).map((l) => ({
          level: l.level,
          name: l.name,
          status: safeCast(l.status, VALID_DIAGNOSIS_LEVEL_STATUSES, "pending"),
          finding: l.finding,
        })),
      }));
    }
  }

  const entitySummaries: EntitySummaryData[] = ENTITY_KEYS.map((key) => {
    const mapping = ENTITY_MAPPINGS[key];
    const byStatus: Record<string, number> = entityData?.by_status?.[key] ?? {};
    return {
      kind: mapping.kind,
      displayName: mapping.display,
      total: entityData?.counts?.[key] ?? 0,
      byStatus,
    };
  });

  const timelineEvents: TimelineEvent[] = (api.timeline?.events ?? [])
    .map((ev: ApiTimelineEvent) => ({
      id: ev.id ?? "",
      type: ev.type,
      phase: ev.phase ? safePhaseName(ev.phase) : undefined,
      timestamp: ev.ts ?? "",
      summary: ev.summary ?? "",
      refs: ev.refs ?? [],
      level: safeCast(ev.level, VALID_TIMELINE_LEVELS, "info"),
      from: ev.from,
      to: ev.to,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const journalEntries: JournalEntry[] = (api.journal?.notes ?? []).map((n: ApiJournalNote) => ({
    id: n.id,
    author: n.author ?? "agent",
    kind: n.kind,
    summary: n.summary,
    note: n.note ?? "",
    phase: n.phase ? safePhaseName(n.phase) : undefined,
    importance: safeCast(n.importance, VALID_JOURNAL_IMPORTANCE, "normal"),
    createdAt: n.ts ?? "",
  }));

  const entities: Entity[] = (api.entityRecords ?? []).map((r) => ({
    id: r.id,
    kind: safeCast(r.kind, VALID_ENTITY_KINDS, "idea"),
    status: safeCast(r.status, VALID_ENTITY_STATUSES, "unknown"),
    phase: safePhaseName(r.phase),
    title: r.title,
    createdAt: r.created ?? "",
    updatedAt: r.updated ?? r.created ?? "",
  }));

  const phaseRunCards: PhaseRunCard[] = (api.phaseRuns ?? []).map((r) => ({
    id: r.id,
    phase: safePhaseName(r.phase),
    status: safeCast(r.status, VALID_PHASE_RUN_STATUSES, "promoted"),
    created: r.created ?? "",
    updated: r.updated ?? "",
    round: r.inner_loop?.round ?? 1,
    attempts: r.inner_loop?.attempts ?? 1,
    pivotTo: r.pivot ? (safePhaseName(r.pivot.to) as PhaseName) : undefined,
    pivotCategory: r.pivot?.category,
  }));

  const dynamicPivotEdges: PivotEdge[] = [];
  const seenEdges = new Set<string>();
  for (const r of api.phaseRuns ?? []) {
    if (r.pivot) {
      const from = safePhaseName(r.pivot.from);
      const to = safePhaseName(r.pivot.to);
      const key = `${from}->${to}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        dynamicPivotEdges.push({
          from,
          to,
          label: r.pivot.category ?? "pivot",
          trigger: r.pivot.rationale ?? "",
        });
      }
    }
  }
  for (const e of STATIC_PIVOT_EDGES) {
    const key = `${e.from}->${e.to}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      dynamicPivotEdges.push(e);
    }
  }

  return {
    projectId: workflow.anchor ?? "unknown",
    projectName: workflow.project_summary ?? workflow.anchor ?? "Research Project",
    projectSummary: workflow.project_summary ?? undefined,
    anchor: workflow.anchor ?? undefined,
    currentPhase,
    phases,
    entities,
    entitySummaries,
    timeline: timelineEvents,
    journal: journalEntries,
    pivotEdges: dynamicPivotEdges,
    phaseRunCards,
    lastUpdated: new Date().toISOString(),
  };
}

/** True when the payload shows a Scope with no initialized research project. */
export function isEmptyMonitor(api: ApiResponse): boolean {
  const wf = api.workflow;
  const hasAnchor = Boolean(wf?.anchor || wf?.current_phase);
  const hasRuns = Boolean(api.phaseRuns?.length);
  const hasEvents = Boolean(api.timeline?.events?.length);
  const hasNotes = Boolean(api.journal?.notes?.length);
  const hasEntities = Object.values(api.entities?.counts ?? {}).some((c) => c > 0);
  return !hasAnchor && !hasRuns && !hasEvents && !hasNotes && !hasEntities;
}
