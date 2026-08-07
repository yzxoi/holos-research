import z from "zod";

// ---------------------------------------------------------------------------
// Red-line rules (research integrity guardrails)
// ---------------------------------------------------------------------------

export const RedlineRule = z.enum([
  "R1_metric_immutability",
  "R2_eval_integrity",
  "R3_no_data_leakage",
  "R4_honest_reporting",
  "R5_dataset_integrity",
  "R6_reproducibility",
  "R7_domain_constraints",
]);
export type RedlineRule = z.infer<typeof RedlineRule>;

export const RedlineStatus = z.enum(["pending", "passed", "flagged", "violated", "waived"]);
// Red-line status transitions: pending → {passed, flagged, violated}, violated → waived, flagged → {passed, violated, waived}
// Note: enforcement is at the tool level, not schema level
export type RedlineStatus = z.infer<typeof RedlineStatus>;

export const ExperimentRedline = z.object({
  rules: z.array(RedlineRule),
  domain_constraints: z.array(z.string()).optional(),
  status: z.record(RedlineRule, RedlineStatus),
  auditor_report: z.string().optional(),
});
export type ExperimentRedline = z.infer<typeof ExperimentRedline>;

// ---------------------------------------------------------------------------
// Evidence authenticity (prototype → pilot → evidence)
// ---------------------------------------------------------------------------

export const EvidenceAuthenticity = z.enum(["prototype", "pilot", "evidence"]);
export type EvidenceAuthenticity = z.infer<typeof EvidenceAuthenticity>;

// ---------------------------------------------------------------------------
// Entity prefixes & ID system
// ---------------------------------------------------------------------------

export const EntityPrefix = z.enum(["idea", "plan", "exp", "claim", "exh", "paper", "sub"]);
export type EntityPrefix = z.infer<typeof EntityPrefix>;

// ---------------------------------------------------------------------------
// Review entry (shared across all object tools)
// ---------------------------------------------------------------------------

export const ReviewVerdict = z.enum(["pass", "revise", "rethink"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const ReviewerRole = z.enum(["inspector", "auditor", "critic", "editor"]);
export type ReviewerRole = z.infer<typeof ReviewerRole>;

export const ReviewEntry = z.object({
  ts: z.string(),
  round: z.number(),
  reviewer: ReviewerRole.describe("Reviewer role: inspector, auditor, critic, or editor"),
  focus: z.string().optional(),
  verdict: ReviewVerdict.optional(),
  summary: z.string(),
  action_items: z.array(z.string()).optional(),
  scores: z.record(z.string(), z.number()).optional(),
  review_file: z.string().optional(),
});

export type ReviewEntry = z.infer<typeof ReviewEntry>;

// ---------------------------------------------------------------------------
// Idea
// ---------------------------------------------------------------------------

export const IdeaStatus = z.enum(["proposed", "exploring", "grounding", "selected", "parked", "rejected"]);

export const IdeaYaml = z.object({
  id: z.string(),
  title: z.string(),
  status: IdeaStatus,
  round: z.number().default(1),
  derived_from: z.array(z.string()).optional(),
  selected_by: z.string().optional(),
  selected_date: z.string().optional(),
  created: z.string(),
  story_ref: z.string().optional(),
  plan_refs: z.array(z.string()).default([]),
});

export type IdeaYaml = z.infer<typeof IdeaYaml>;

// ---------------------------------------------------------------------------
// RQG Criteria (defined before Plan so PlanYaml can reference them)
// ---------------------------------------------------------------------------

export const KillCriterion = z.object({
  id: z.string(),
  claim_ref: z.string().optional(),
  experiment_role: z.string(),
  metric: z.string(),
  direction: z.enum(["max", "min"]),
  baseline_value: z.number().optional(), // §7.3 specifies as required; kept optional for migration compat; @remove-after 2026-07
  target_delta: z.number().optional(),
  min_effect_size: z.object({ kind: z.string(), threshold: z.number() }).optional(), // §7.3 specifies as required; kept optional for migration compat; @remove-after 2026-07
  statistical_test: z.object({ kind: z.string(), level: z.number(), must_exclude_zero: z.boolean() }).optional(), // §7.3 specifies as required; kept optional for migration compat; @remove-after 2026-07
  min_seeds: z.number().default(3),
  failure_interpretation: z.string().optional(),
});

export type KillCriterion = z.infer<typeof KillCriterion>;

export const SufficientCriterion = z.object({
  id: z.string(),
  claim_ref: z.string().optional(),
  experiment_role: z.string(),
  metric: z.string(),
  direction: z.enum(["max", "min"]),
  target_value: z.number().optional(),
  min_seeds: z.number().default(3),
});

export type SufficientCriterion = z.infer<typeof SufficientCriterion>;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const PlanStatus = z.enum(["draft", "refining", "approved", "active", "superseded", "cancelled"]);

export const PlanYaml = z.object({
  id: z.string(),
  title: z.string(),
  status: PlanStatus,
  idea_ref: z.string().optional(),
  supersedes: z.string().optional(),
  approved_by: z.string().optional(),
  approved_date: z.string().optional(),
  created: z.string(),
  story_ref: z.string().optional(),
  // @deprecated §7.1 — formal_method_spec was never populated; retained for migration compat only; @remove-after 2026-07
  formal_method_spec: z.string().optional(),
  kill_set: z.array(KillCriterion).default([]),
  sufficient_set: z.array(SufficientCriterion).default([]),
  // @deprecated §7.1 — realization_status was never populated; retained for migration compat only; @remove-after 2026-07
  realization_status: z.string().optional(),
  experiment_refs: z.array(z.string()).default([]),
  code_artifact_refs: z.array(z.string()).default([]),
  rqg_refs: z.array(z.string()).default([]),
  diagnosis_refs: z.array(z.string()).default([]),
});

export type PlanYaml = z.infer<typeof PlanYaml>;

// ---------------------------------------------------------------------------
// Experiment
// ---------------------------------------------------------------------------

export const GpuType = z.enum(["H100", "H200", "A100", "A100-80G", "RTX-4090", "RTX-3090", "V100", "T4", "OTHER"]);
export type GpuType = z.infer<typeof GpuType>;

export const ExperimentStatus = z.enum([
  "registered",
  "scheduled",
  "running",
  "completed",
  "failed",
  "invalidated",
  "stopped",
]);
export const ExperimentGroup = z.enum(["sanity", "baselines", "main", "ablations", "robustness", "stress"]);
export const ExperimentBackend = z.enum(["inspire", "local", "api", "manual"]);

export const ExperimentYaml = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  group: ExperimentGroup.optional(),
  status: ExperimentStatus,
  backend: ExperimentBackend.optional(),
  idea_ref: z.string().optional(),
  plan_ref: z.string().optional(),
  created: z.string(),
  updated: z.string().optional(),
  code_commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/, "Must be a valid git commit hash (7-40 hex chars)")
    .optional(),
  command: z.string().optional(),

  job_id: z.string().optional(),
  started: z.string().optional(),
  finished: z.string().optional(),

  environment: z
    .object({
      platform: z.string().optional(),
      gpu: z.string().optional(),
      gpu_type: GpuType.optional(),
      gpu_count: z.number().optional(),
      nodes: z.number().optional(),
      image: z.string().optional(),
      cpu_count: z.number().optional(),
      memory_gb: z.number().optional(),
    })
    .optional(),

  hyperparameters: z.record(z.string(), z.unknown()).optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  artifacts: z.record(z.string(), z.string()).optional(),
  failure_reason: z.string().optional(),
  invalidation_reason: z.string().optional(),
  redlines: ExperimentRedline.optional(),
  authenticity: EvidenceAuthenticity.optional(),
  code_artifact_ref: z.string().optional(),
  phase_run_ref: z.string().optional(),
  debug_depth: z.number().optional(),
  diagnosis_ref: z.string().optional(),
  fabrication_flag: z.boolean().optional(),
  rqg_contributions: z.array(z.string()).default([]),
  seed: z.number().optional(),
  log: z.array(z.record(z.string(), z.unknown())).default([]),
  notes: z.array(z.string()).default([]),
});

export type ExperimentYaml = z.infer<typeof ExperimentYaml>;

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export const ClaimStatus = z.enum(["candidate", "supported", "qualified", "weak", "retracted", "final"]);

export const ClaimYaml = z.object({
  id: z.string(),
  title: z.string(),
  status: ClaimStatus,
  statement: z.string().optional(),
  evidence: z
    .array(
      z.object({
        ref: z.string(),
        role: z.string().optional(),
        strength: z.enum(["strong", "moderate", "weak"]).optional(),
      }),
    )
    .default([]),
  caveats: z.array(z.string()).default([]),
  paper_section: z.string().optional(),
  created: z.string(),
  story_ref: z.string().optional(),
  paper_path_ref: z.string().optional(),
  evidence_strength_score: z.number().optional(),
  story_fit_score: z.number().optional(),
  fabrication_flag: z.boolean().optional(),
});

export type ClaimYaml = z.infer<typeof ClaimYaml>;

// ---------------------------------------------------------------------------
// Exhibit
// ---------------------------------------------------------------------------

export const ExhibitStatus = z.enum(["draft", "rendered", "verified", "approved", "superseded", "dropped"]);
export const ExhibitKind = z.enum([
  "figure",
  "table",
  "supplementary_figure",
  "supplementary_table",
  "extended_data",
  "appendix",
]);

export const ExhibitYaml = z.object({
  id: z.string(),
  title: z.string(),
  kind: ExhibitKind,
  status: ExhibitStatus,
  label: z.string().optional(),
  sources: z
    .object({
      experiments: z.array(z.string()).default([]),
      claims: z.array(z.string()).default([]),
      script: z.string().optional(),
      data_path: z.string().optional(),
    })
    .default({ experiments: [], claims: [] }),
  output_path: z.string().optional(),
  supersedes: z.string().optional(),
  created: z.string(),
});

export type ExhibitYaml = z.infer<typeof ExhibitYaml>;

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------

export const PaperStatus = z.enum(["outlined", "drafting", "revising", "ready", "frozen", "archived"]);

export const PaperYaml = z.object({
  id: z.string(),
  title: z.string(),
  status: PaperStatus,
  venue: z.string().optional(),
  source_dir: z.string().optional(),
  sections: z
    .array(
      z.object({
        name: z.string(),
        file: z.string().optional(),
        status: z.enum(["pending", "drafted", "revised", "final"]).default("pending"),
      }),
    )
    .default([]),
  claims: z.array(z.string()).default([]),
  exhibits: z.array(z.string()).default([]),
  created: z.string(),
});

export type PaperYaml = z.infer<typeof PaperYaml>;

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

// Note: revision_requested and resubmitted are V2.1 additions beyond the original §4.2 flow
export const SubmissionStatus = z.enum([
  "preparing",
  "submitted",
  "under_review",
  "rebuttal",
  "revision_requested",
  "resubmitted",
  "accepted",
  "rejected",
  "closed",
]);

export const SubmissionYaml = z.object({
  id: z.string(),
  title: z.string(),
  status: SubmissionStatus,
  paper: z.string().optional(),
  venue: z.string().optional(),
  submitted_date: z.string().optional(),
  rounds: z
    .array(
      z.object({
        round: z.number(),
        status: z.string(),
        date: z.string(),
        summary: z.string().optional(),
      }),
    )
    .default([]),
  created: z.string(),
});

export type SubmissionYaml = z.infer<typeof SubmissionYaml>;

// ---------------------------------------------------------------------------
// State (project-level)
// ---------------------------------------------------------------------------

// v2.1: 6-phase core flow. Old phases (spec→design, claim/audit/submit_review/archive) are readable via backward-compat mapping.
export const ProjectPhase = z.enum(["explore", "ground", "design", "realize", "experiment", "compose"]);

export type ProjectPhaseType = z.infer<typeof ProjectPhase>;

/** Canonical phase ordering used across the codebase. */
export const PHASE_ORDER: [ProjectPhaseType, ...ProjectPhaseType[]] = [
  "explore",
  "ground",
  "design",
  "realize",
  "experiment",
  "compose",
];

export const ParticipationMode = z.enum(["collaborative", "guided", "autonomous"]);
export const ExplorationDepth = z.enum(["light", "standard", "thorough"]);
export const ExplorationPilot = z.enum(["enabled", "skip"]);

export const ExplorationConfig = z.object({
  depth: ExplorationDepth.default("standard"),
  pilot: ExplorationPilot.default("enabled"),
  max_refine_rounds: z.number().default(3),
  idea_select_score: z.number().default(8),
  idea_generators: z.number().default(3),
});

export type ExplorationConfig = z.infer<typeof ExplorationConfig>;

export const GroundConfig = z.object({
  max_review_rounds: z.number().default(2),
  max_closest_works: z.number().default(3),
});

export type GroundConfig = z.infer<typeof GroundConfig>;

export const DesignConfig = z.object({
  max_review_rounds: z.number().default(5),
  score_threshold: z.number().default(7),
  max_primary_claims: z.number().default(2),
  max_new_components: z.number().default(2),
});

export type DesignConfig = z.infer<typeof DesignConfig>;

export const RealizeConfig = z.object({
  max_review_rounds: z.number().default(3),
  code_review_threshold: z.number().default(7),
  require_sanity_contract: z.boolean().default(true),
  require_quality_contract: z.boolean().default(true),
});

export type RealizeConfig = z.infer<typeof RealizeConfig>;

export const ExperimentConfig = z.object({
  max_optimize_rounds: z.number().default(3),
  monitor_interval: z.string().default("30m"),
  significance_level: z.number().default(0.05),
  min_seeds: z.number().default(3),
  regression_tolerance: z.number().default(0.05),
});

export type ExperimentConfig = z.infer<typeof ExperimentConfig>;

export const ComposeConfig = z.object({
  max_revise_rounds: z.number().default(3),
});

export type ComposeConfig = z.infer<typeof ComposeConfig>;

// Backward-compat types: old state files may reference these configs.
// They are no longer part of the core StateYaml but are kept as exported
// types so migration/upgrade tools can read legacy files.

export const StateYaml = z.object({
  project: z.string(),
  anchor: z.string().optional(),
  /** Agent-generated concise project summary (≤60 chars). Set once during init, used by monitor board. */
  project_summary: z.string().optional(),
  /** Schema version for migration tracking. v2 = V2.1 state machine. */
  schema_version: z.number().default(2),
  created: z.string(),
  updated: z.string(),

  config: z.object({
    participation_mode: ParticipationMode.default("collaborative"),
    venue: z.string().optional(),
    stalled_days: z.number().default(7),
    exploration: ExplorationConfig.default(() => ExplorationConfig.parse({})),
    ground: GroundConfig.default(() => GroundConfig.parse({})),
    design: DesignConfig.default(() => DesignConfig.parse({})),
    realize: RealizeConfig.default(() => RealizeConfig.parse({})),
    experiment: ExperimentConfig.default(() => ExperimentConfig.parse({})),
    compose: ComposeConfig.default(() => ComposeConfig.parse({})),
  }),

  counters: z.object({
    idea: z.number().default(0),
    plan: z.number().default(0),
    exp: z.number().default(0),
    claim: z.number().default(0),
    exh: z.number().default(0),
    paper: z.number().default(0),
    sub: z.number().default(0),
  }),

  // @deprecated §7.1 — maps old phase names (e.g. "spec") to V2.1 names; retained for migration compat only; @remove-after 2026-07
  _compat_phase_map: z.record(z.string(), z.string()).optional(),

  focus: z
    .object({
      since: z.string(),
      phase: ProjectPhase,
      summary: z.string().optional(),
      reason: z.string().optional(),
      active_phase_run: z.string().optional(),
      blocked_on: z.string().nullable().optional(),
      next: z.string().optional(),
      // Backward compat: old projects may have refs here; read from phase_run first
      refs: z
        .object({
          idea_ref: z.string().optional(),
          plan_ref: z.string().optional(),
          experiment_refs: z.array(z.string()).optional(),
          claim_refs: z.array(z.string()).optional(),
          exhibit_refs: z.array(z.string()).optional(),
          paper_ref: z.string().optional(),
          submission_ref: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type StateYaml = z.infer<typeof StateYaml>;

// ---------------------------------------------------------------------------
// Literature wiki types (managed by research_wiki tool)
// ---------------------------------------------------------------------------

export const PaperRelevance = z.enum(["core", "related", "peripheral"]);

export const LitPaperYaml = z.object({
  slug: z.string(),
  title: z.string(),
  authors: z.array(z.string()).default([]),
  year: z.number().optional(),
  venue: z.string().optional(),
  arxiv: z.string().optional(),
  doi: z.string().optional(),
  tags: z.array(z.string()).default([]),
  relevance: PaperRelevance.default("related"),
  cite_key: z.string().optional(),
  created: z.string(),
  updated: z.string(),
});

export type LitPaperYaml = z.infer<typeof LitPaperYaml>;

export const GapStatus = z.enum(["open", "partially_addressed", "closed"]);

export const GapYaml = z.object({
  id: z.string(),
  description: z.string(),
  status: GapStatus.default("open"),
  source_paper: z.string().optional(),
  linked_ideas: z.array(z.string()).default([]),
  created: z.string(),
  closed: z.string().optional(),
});

export type GapYaml = z.infer<typeof GapYaml>;

export const EdgeType = z.enum([
  "extends",
  "contradicts",
  "addresses_gap",
  "inspired_by",
  "tested_by",
  "supports",
  "invalidates",
  "supersedes",
]);

export type EdgeType = z.infer<typeof EdgeType>;

export const Edge = z.object({
  from: z.string(),
  to: z.string(),
  type: EdgeType,
  evidence: z.string().optional(),
  created: z.string(),
});

export type Edge = z.infer<typeof Edge>;

export const WikiLogEntry = z.object({
  ts: z.string(),
  action: z.string(),
  target: z.string().optional(),
  summary: z.string(),
});

export type WikiLogEntry = z.infer<typeof WikiLogEntry>;

// ---------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------

export const TimelineEventType = z.enum([
  // system
  "research.init",
  "focus.changed",
  // idea
  "idea.created",
  "idea.status",
  "idea.reviewed",
  // plan
  "plan.created",
  "plan.status",
  "plan.reviewed",
  // experiment
  "exp.created",
  "exp.status",
  "exp.reviewed",
  // claim
  "claim.created",
  "claim.status",
  "claim.reviewed",
  // exhibit
  "exhibit.created",
  "exhibit.status",
  "exhibit.reviewed",
  // paper
  "paper.created",
  "paper.status",
  "paper.reviewed",
  "paper.bind",
  // submission
  "submission.created",
  "submission.status",
  "submission.reviewed",
  // wiki
  "wiki.paper_ingested",
  "wiki.gap_registered",
  // override/bypass events
  "entity.status_override",
  "transition.bypass",
  // exhibit bindings
  "exhibit.bind_sources",
  // free events
  "insight",
  "milestone",
  "decision",
]);

export const TimelineEvent = z.object({
  ts: z.string(),
  type: TimelineEventType,
  id: z.string().optional(),
  title: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  by: z.string().optional(),
  phase: z.string().optional(),
  group: z.string().optional(),
  level: z.enum(["trace", "info", "decision", "gate", "pivot", "human", "critical"]).optional(),
  refs: z.array(z.string()).optional(),
  summary: z.string().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
});

export type TimelineEvent = z.infer<typeof TimelineEvent>;

// ---------------------------------------------------------------------------
// v2.1 Core Types
// ---------------------------------------------------------------------------

export const StorySpine = z.object({
  id: z.string(),
  idea_ref: z.string(),
  version: z.number(),
  status: z.enum(["proposed", "grounded", "confirmed", "archived", "rejected"]).default("proposed"),
  // Core narrative (set in explore)
  field_assumption: z.string(),
  pain_point: z.string(),
  non_obvious_insight: z.string(),
  why_now: z.string().optional(),
  what_changes_if_true: z.string(),
  beneficiaries: z.array(z.string()).default([]),
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
    .default([]),
  story_risks: z.array(z.string()).default([]),
  scores: z.record(z.string(), z.number()).default({}),
  // Grounding output (set in ground via reframing)
  grounded_angle: z
    .object({
      type: z.string(),
      title_sketch: z.string(),
      paper_thesis: z.string(),
    })
    .optional(),
  closest_work_positioning: z.array(z.record(z.string(), z.string())).default([]),
  expected_main_claims: z.array(z.string()).default([]),
  minimum_evidence: z.array(z.string()).default([]),
  fallback_paths: z.array(z.record(z.string(), z.string())).default([]),
  reframe_history: z
    .array(
      z.object({
        from_type: z.string(),
        to_type: z.string(),
        rationale: z.string(),
      }),
    )
    .default([]),
  claim_refs: z.array(z.string()).default([]),
});

export type StorySpine = z.infer<typeof StorySpine>;

export const CheckpointKind = z.enum([
  "taste_selection",
  "resource_commitment",
  "reasonableness_check",
  "pivot_confirmation",
  "paper_ambition",
  "submission_readiness",
]);
export type CheckpointKind = z.infer<typeof CheckpointKind>;

/** Set of all valid checkpoint kinds for validation. */
export const VALID_CHECKPOINT_KINDS = new Set<string>(CheckpointKind.options);

export const CheckpointStatus = z.enum(["pending", "confirmed", "waived"]);
export type CheckpointStatus = z.infer<typeof CheckpointStatus>;

// ── Resource Specification ────────────────────────────────────────────────────

export const ResourceSpec = z.object({
  gpu_type: GpuType.describe("GPU type (4090/H100/H200 etc.)"),
  gpu_count: z.number().default(1).describe("Number of GPUs per node"),
  nodes: z.number().default(1).describe("Number of compute nodes"),
  cpu_count: z.number().optional().describe("Number of CPUs per node"),
  memory_gb: z.number().optional().describe("Memory in GB per node"),
  shm_mb: z.number().optional().describe("Shared memory in MB"),
  estimated_gpu_hours: z.number().optional().describe("Estimated total GPU hours"),
  timeout_hours: z.number().optional().describe("Maximum job runtime in hours"),
  priority: z.number().optional().describe("Job priority (higher = more urgent)"),
});
export type ResourceSpec = z.infer<typeof ResourceSpec>;

export const ResourceCommitment = z.object({
  resource_spec: ResourceSpec.describe("Requested compute resources"),
  workspace: z.string().optional().describe("Inspire workspace name"),
  compute_group: z.string().optional().describe("Inspire compute group ID"),
  image: z.string().optional().describe("Docker image for the compute environment"),
  connection_method: z
    .enum(["rtunnel", "holos-inspire", "inspire", "local", "api", "manual"])
    .optional()
    .describe("How to connect to the compute instance"),
  connection_url: z.string().optional().describe("Connection URL (rtunnel SSH or holos-inspire link)"),
  fallback_plan: z.string().optional().describe("Fallback if primary resources unavailable"),
  budget_approved: z.boolean().default(false).describe("Whether the resource budget has been approved"),
});
export type ResourceCommitment = z.infer<typeof ResourceCommitment>;

export const HumanCheckpoint = z.object({
  kind: CheckpointKind,
  status: CheckpointStatus,
  question: z.string().optional(),
  decision: z.string().optional(),
  rationale: z.string().optional(),
  waived_reason: z.string().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  resource_commitment: ResourceCommitment.optional().describe(
    "Structured resource spec for resource_commitment checkpoints",
  ),
  brief_ref: z
    .string()
    .optional()
    .describe("Path to the checkpoint brief markdown file (e.g., checkpoint_briefs/brief_xxx.md)"),
  brief_generated_at: z.string().optional().describe("Timestamp when the brief was generated"),
});
export type HumanCheckpoint = z.infer<typeof HumanCheckpoint>;

export const PhaseRunStatus = z.enum(["active", "promoted", "pivoted", "aborted", "blocked"]);
export type PhaseRunStatus = z.infer<typeof PhaseRunStatus>;

export const InnerLoopState = z.enum(["attempt", "evaluate", "decide", "promoted", "pivoted", "aborted", "blocked"]);
export type InnerLoopState = z.infer<typeof InnerLoopState>;

export const LastDecision = z.enum(["iterate", "promote", "pivot", "abort"]);
export type LastDecision = z.infer<typeof LastDecision>;

export const PhaseRun = z.object({
  id: z.string(),
  phase: ProjectPhase,
  status: PhaseRunStatus,
  created: z.string(),
  updated: z.string(),
  inner_loop: z.object({
    state: InnerLoopState,
    created: z.string(),
    updated: z.string(),
    round: z.number().default(1),
    attempts: z.number().default(0),
    stagnation_rounds: z.number().default(0),
    escalation_count: z.number().default(0),
    last_decision: LastDecision.optional(),
    pre_block_state: InnerLoopState.optional().describe("Saved inner_loop state before block, for resume restoration."),
    budget: z
      .object({
        max_attempts: z.number().default(6),
        max_stagnation: z.number().default(2),
        max_escalations: z.number().default(2),
      })
      .optional(),
    progress_metric: z
      .object({
        name: z.string(),
        previous: z.number().optional(),
        current: z.number().optional(),
        direction: z.enum(["max", "min"]).optional(),
      })
      .optional(),
    summary: z.string().optional(),
    round_started_at: z.string().optional(),
  }),
  refs: z
    .object({
      idea_ref: z.string().optional(),
      plan_ref: z.string().optional(),
      experiment_refs: z.array(z.string()).optional(),
      claim_refs: z.array(z.string()).optional(),
      exhibit_refs: z.array(z.string()).optional(),
      paper_ref: z.string().optional(),
      submission_ref: z.string().optional(),
      story_ref: z.string().optional(),
      diagnosis_ref: z.string().optional(),
      rqg_ref: z.string().optional(),
    })
    .optional(),
  human_checkpoints: z.array(HumanCheckpoint).default([]),
  context_refresh: z
    .object({
      refreshed_at: z.string(),
      trigger: z.string(),
      loaded: z.record(z.string(), z.unknown()).default({}),
      used_wiki_refs: z.array(z.string()).default([]),
      checked_skill_rules: z.array(z.string()).default([]),
      drift_check: z
        .object({
          status: z.enum(["pass", "warning", "block"]),
          note: z.string().optional(),
        })
        .optional(),
      next: z.string().optional(),
    })
    .optional(),
  artifacts: z.record(z.string(), z.string()).default({}),
  summary: z.string().optional(),
  pivot: z
    .object({
      from: z.string(),
      to: z.string(),
      category: z.enum([
        "story_mismatch",
        "method_failure",
        "infra_failure",
        "data_failure",
        "evidence_gap",
        "review_demand",
        "scope_shift",
      ]),
      evidence_refs: z.array(z.string()).default([]),
      diagnosis_ref: z.string().optional(),
      rationale: z.string(),
      alternatives_considered: z.array(z.string()).default([]),
      human_decision: z
        .object({
          required: z.boolean().default(true),
          status: z.enum(["pending", "confirmed", "waived"]).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type PhaseRun = z.infer<typeof PhaseRun>;

export const JournalNote = z.object({
  id: z.string(),
  ts: z.string(),
  author: z.enum(["human", "agent", "tool", "subagent"]),
  phase: ProjectPhase.optional(),
  phase_run_ref: z.string().optional(),
  kind: z.enum([
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
  ]),
  importance: z.enum(["normal", "important", "critical"]).default("normal"),
  refs: z.array(z.string()).default([]),
  summary: z.string(),
  note: z.string(),
  source_event: z.string().optional(),
});

export type JournalNote = z.infer<typeof JournalNote>;

export const SnapshotManifest = z.object({
  id: z.string(),
  created: z.string(),
  trigger: z.string(),
  phase: ProjectPhase.optional(),
  next_phase: ProjectPhase.optional(),
  summary: z.string(),
  refs: z.record(z.string(), z.string()).default({}),
  artifact_hashes: z.record(z.string(), z.string()).default({}),
});

export type SnapshotManifest = z.infer<typeof SnapshotManifest>;

export const RQGReport = z.object({
  id: z.string(),
  plan_ref: z.string(),
  experiment_refs: z.array(z.string()).default([]),
  kill_set: z
    .array(
      z.object({
        id: z.string(),
        passed: z.boolean(),
        observed_delta: z.number().optional(),
        cohen_d: z.number().optional(),
        ci: z.array(z.number()).optional(),
      }),
    )
    .default([]),
  sufficient_set: z
    .array(
      z.object({
        id: z.string(),
        passed: z.boolean(),
        observed: z.number().optional(),
        target: z.number().optional(),
        gap: z.number().optional(),
      }),
    )
    .default([]),
  integrity: z
    .object({
      metric_recompute: z.enum(["pass", "fail", "pending"]).default("pending"),
      artifact_hash: z.enum(["pass", "fail", "pending"]).default("pending"),
      redlines: z.enum(["pass", "fail", "pending"]).default("pending"),
    })
    .optional(),
  overall: z.enum(["passed", "partial", "failed", "invalid"]).default("invalid"),
  allowed_next: z.array(z.string()).default([]),
  disallowed_next: z.array(z.string()).default([]),
  kill_criteria_failed: z.boolean().default(false),
  integrity_notes: z.array(z.string()).optional(),
});

export type RQGReport = z.infer<typeof RQGReport>;

export const DiagnosisReport = z.object({
  id: z.string(),
  experiment_refs: z.array(z.string()).default([]),
  plan_ref: z.string().optional(),
  code_artifact_ref: z.string().optional(),
  levels: z
    .object({
      L1_training_health: z
        .object({
          status: z.enum(["pass", "warning", "fail", "pending"]).default("pending"),
          evidence: z.string().optional(),
          recommended_action: z.string().optional(),
        })
        .optional(),
      L2_eval_correctness: z
        .object({
          status: z.enum(["pass", "warning", "fail", "pending"]).default("pending"),
          evidence: z.string().optional(),
          recommended_action: z.string().optional(),
        })
        .optional(),
      L3_data_integrity: z
        .object({
          status: z.enum(["pass", "warning", "fail", "pending"]).default("pending"),
          evidence: z.string().optional(),
          recommended_action: z.string().optional(),
        })
        .optional(),
      L4_hyperparameter_range: z
        .object({
          status: z.enum(["pass", "warning", "fail", "pending"]).default("pending"),
          evidence: z.string().optional(),
          recommended_action: z.string().optional(),
        })
        .optional(),
      L5_seed_stability: z
        .object({
          status: z.enum(["pass", "warning", "fail", "pending"]).default("pending"),
          evidence: z.string().optional(),
          recommended_action: z.string().optional(),
        })
        .optional(),
      L6_benchmark_story_alignment: z
        .object({
          status: z.enum(["pass", "warning", "fail", "pending"]).default("pending"),
          evidence: z.string().optional(),
          recommended_action: z.string().optional(),
        })
        .optional(),
    })
    .default({}),
  rqg_ref: z.string().optional(),
  conclusion: z
    .object({
      likely_cause: z.string().optional(),
      recommended_decision: z.enum(["iterate", "pivot", "promote", "abort"]).optional(),
      forbidden_decisions: z.array(z.string()).default([]),
    })
    .optional(),
});

export type DiagnosisReport = z.infer<typeof DiagnosisReport>;
