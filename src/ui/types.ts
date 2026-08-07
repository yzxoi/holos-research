export type PhaseName = "explore" | "ground" | "design" | "realize" | "experiment" | "compose";

export type PhaseStatus = "active" | "completed" | "pending" | "blocked";

export type EntityKind = "idea" | "plan" | "experiment" | "claim" | "exhibit" | "paper" | "submission";

export type EntityStatus =
  // Ideas
  | "proposed"
  | "exploring"
  | "grounding"
  | "selected"
  | "parked"
  | "rejected"
  // Plans
  | "draft"
  | "active"
  | "superseded"
  | "approved"
  | "dropped"
  | "stopped"
  // Experiments
  | "registered"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "invalidated"
  | "stopped"
  // Claims
  | "candidate"
  | "supported"
  | "qualified"
  | "weak"
  | "retracted"
  | "final"
  // Exhibits
  | "outlined"
  | "drafting"
  | "revising"
  | "ready"
  | "frozen"
  | "verified"
  // Papers
  | "revising"
  | "ready"
  | "approved"
  | "submitted"
  | "under_review"
  | "rebuttal"
  | "revision_requested"
  | "resubmitted"
  | "accepted"
  | "rejected"
  | "closed"
  // Submissions
  | "preparing"
  | "submitted"
  | "under_review"
  | "rebuttal"
  | "revision_requested"
  | "resubmitted"
  | "accepted"
  | "rejected"
  | "closed"
  // Generic fallbacks
  | "archived"
  | "unknown";

export interface Entity {
  id: string;
  kind: EntityKind;
  status: EntityStatus;
  phase: PhaseName;
  title: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

/** v2.1 inner loop states: attempt → evaluate → decide → (blocked | promoted | pivoted | aborted) */
export type InnerLoopState = "attempt" | "evaluate" | "decide" | "blocked" | "promoted" | "pivoted" | "aborted";

/** GPU type selection for compute resources */
export type GpuType = "H100" | "H200" | "A100" | "A100-80G" | "RTX-4090" | "RTX-3090" | "V100" | "T4" | "OTHER";

/** Connection method for compute instances */
export type ConnectionMethod = "rtunnel" | "holos-inspire" | "inspire" | "local" | "api" | "manual";

/** Structured resource specification */
export interface ResourceSpec {
  gpuType: GpuType;
  gpuCount: number;
  nodes: number;
  cpuCount?: number;
  memoryGb?: number;
  shmMb?: number;
  estimatedGpuHours?: number;
  timeoutHours?: number;
  priority?: number;
}

/** Resource commitment declaration for human checkpoint */
export interface ResourceCommitment {
  resourceSpec: ResourceSpec;
  workspace?: string;
  computeGroup?: string;
  image?: string;
  connectionMethod?: ConnectionMethod;
  connectionUrl?: string;
  fallbackPlan?: string;
  budgetApproved: boolean;
}

export interface PhaseRun {
  id: string;
  phase: PhaseName;
  status: "active" | "promoted" | "pivoted" | "aborted" | "blocked";
  created: string;
  updated: string;
  innerLoop: {
    state: InnerLoopState;
    round: number;
    attempts: number;
    stagnationRounds: number;
    lastDecision: "iterate" | "pivot" | "promote" | "abort" | undefined;
    maxAttempts: number;
    maxStagnation: number;
    progressMetric?: { name: string; current: number; previous: number };
    summary?: string;
  };
  refs: {
    idea?: string;
    plan?: string;
    experiments?: string[];
    claims?: string[];
    exhibits?: string[];
    paper?: string;
    submission?: string;
  };
  checkpoints: HumanCheckpoint[];
  pivot?: PivotInfo;
}

export interface PivotInfo {
  from: PhaseName;
  to: PhaseName;
  category: string;
  rationale: string;
  evidenceRefs: string[];
}

export interface HumanCheckpoint {
  kind: string;
  status: "pending" | "confirmed" | "waived";
  question?: string;
  decision?: string;
  rationale?: string;
  waivedReason?: string;
  resourceCommitment?: ResourceCommitment;
  briefRef?: string;
  briefGeneratedAt?: string;
}

/** StorySpine summary shown in explore/ground phase cards */
export interface StorySpineSummary {
  id: string;
  ideaRef: string;
  status: "proposed" | "exploring" | "grounding" | "selected" | "parked" | "rejected";
  fieldAssumption: string;
  painPoint: string;
  nonObviousInsight: string;
  candidateAngles: Array<{ type: string; titleSketch: string }>;
  /** Score dimension name → value */
  scores: Record<string, number>;
}

/** RQG status shown in experiment phase */
export interface RQGSummary {
  id: string;
  overall: "passed" | "partial" | "failed" | "invalid";
  killSetPassed: number;
  killSetTotal: number;
  sufficientSetPassed: number;
  sufficientSetTotal: number;
  allowedNext: string[];
  disallowedNext: string[];
}

/** Diagnosis report shown in experiment phase */
export interface DiagnosisSummary {
  id: string;
  conclusion: string;
  pivotRoute?: string;
  levels: Array<{
    level: string;
    name: string;
    status: "pass" | "fail" | "skip" | "warning" | "pending";
    finding?: string;
  }>;
}

export interface TimelineEvent {
  id?: string;
  type: string;
  phase?: PhaseName;
  timestamp: string;
  summary?: string;
  refs: string[];
  level?: "trace" | "info" | "decision" | "gate" | "pivot" | "human" | "critical";
  from?: string;
  to?: string;
}

export interface JournalEntry {
  id: string;
  author: string;
  kind: string;
  summary: string;
  note: string;
  phase?: PhaseName;
  importance?: "critical" | "important" | "normal";
  createdAt: string;
}

export interface PhaseInfo {
  name: PhaseName;
  displayName: string;
  status: PhaseStatus;
  description: string;
  /** Key question this phase answers (from DESIGN §4.2) */
  keyQuestion: string;
  /** Required artifacts for promote (from DESIGN §4.2) */
  promoteCriteria: string[];
  /** Allowed pivot targets from this phase */
  pivotTargets: Array<{ to: PhaseName; trigger: string }>;
  entityCount: number;
  latestActivity?: string;
  run?: PhaseRun;
  /** StorySpine summaries (explore/ground only) */
  stories?: StorySpineSummary[];
  /** RQG summaries (experiment only) */
  rqg?: RQGSummary[];
  /** Diagnosis summaries (experiment only) */
  diagnosis?: DiagnosisSummary[];
  checkpoints: HumanCheckpoint[];
  contextRefreshedAt?: string;
  /** Active focus entity refs from API */
  focusRefs?: {
    idea?: string;
    plan?: string;
    experiments: string[];
    claims: string[];
    exhibits: string[];
    paper?: string;
    submission?: string;
  };
}

export interface EntitySummaryData {
  kind: EntityKind;
  displayName: string;
  total: number;
  /** Status name → count; keys are dynamic status strings from the API */
  byStatus: Record<string, number>;
}

/** Pivot edge in the workflow graph */
export interface PivotEdge {
  from: PhaseName;
  to: PhaseName;
  label: string;
  trigger: string;
}

// ── API response types (shape from /api/all endpoint) ────────────────────────

export interface ApiWorkflowPhase {
  name: string;
  order: number;
  is_current: boolean;
  is_completed: boolean;
  is_pending: boolean;
}

export interface ApiWorkflow {
  current_phase: string | null;
  current_phase_since: string | null;
  blocked_on: string | null;
  phases: ApiWorkflowPhase[];
  anchor: string | null;
  /** Concise one-line project summary derived from anchor (≤60 chars) */
  project_summary: string | null;
  next: string | null;
}

export interface ApiEntities {
  /** Entity counts keyed by plural API names (ideas, plans, experiments, etc.) */
  counts: Record<string, number>;
  /** Status name → { plural API name → count } */
  by_status: Record<string, Record<string, number>>;
  focus_refs: {
    idea?: string;
    plan?: string;
    experiments: string[];
    claims: string[];
    exhibits: string[];
    paper?: string;
    submission?: string;
  };
}

export interface ApiTimelineEvent {
  id?: string;
  ts?: string;
  type: string;
  phase?: string;
  summary?: string;
  refs?: string[];
  level?: string;
  from?: string;
  to?: string;
}

export interface ApiTimeline {
  events: ApiTimelineEvent[];
  count: number;
}

export interface ApiJournalNote {
  id: string;
  ts: string;
  author: string;
  kind: string;
  summary: string;
  note: string;
  phase?: string;
  importance?: string;
}

export interface ApiJournal {
  notes: ApiJournalNote[];
  count: number;
}

export interface ApiCheckpointResourceSpec {
  gpu_type?: string;
  gpu_count?: number;
  nodes?: number;
  cpu_count?: number;
  memory_gb?: number;
  estimated_gpu_hours?: number;
  timeout_hours?: number;
  priority?: number;
}

export interface ApiCheckpointResourceCommitment {
  resource_spec?: ApiCheckpointResourceSpec;
  workspace?: string;
  compute_group?: string;
  image?: string;
  connection_method?: string;
  connection_url?: string;
  fallback_plan?: string;
  budget_approved?: boolean;
}

export interface ApiHumanCheckpoint {
  kind: string;
  status: string;
  question?: string;
  decision?: string;
  rationale?: string;
  waived_reason?: string;
  brief_ref?: string;
  brief_generated_at?: string;
  resource_commitment?: ApiCheckpointResourceCommitment;
}

export interface ApiInnerLoop {
  state: string;
  round: number;
  attempts: number;
  stagnation_rounds: number;
  last_decision?: string;
  budget?: { max_attempts: number; max_stagnation: number };
  progress_metric?: { name: string; current: number; previous: number };
  summary?: string;
}

export interface ApiRunRefs {
  idea_ref?: string;
  plan_ref?: string;
  experiment_refs?: string[];
  claim_refs?: string[];
  exhibit_refs?: string[];
  paper_ref?: string;
  submission_ref?: string;
}

export interface ApiRunPivot {
  from?: string;
  to?: string;
  reason?: string;
  ts?: string;
  category?: string;
  rationale?: string;
  evidence_refs?: string[];
}

export interface ApiRun {
  id: string;
  phase?: string;
  created: string;
  updated: string;
  status: string;
  inner_loop?: ApiInnerLoop;
  refs?: ApiRunRefs;
  human_checkpoints?: ApiHumanCheckpoint[];
  pivot?: ApiRunPivot;
}

export interface ApiActiveRun {
  run: ApiRun | null;
  context: {
    anchor: string | null;
    focus_summary: string | null;
    focus_next: string | null;
    blocked_on: string | null;
  };
}

export interface ApiStorySpine {
  id: string;
  idea_ref: string;
  status: string;
  field_assumption: string;
  pain_point: string;
  non_obvious_insight: string;
  candidate_paper_angles: Array<{ type: string; title_sketch: string }>;
  scores: Record<string, number>;
}

export interface ApiRQGReport {
  id: string;
  overall: string;
  kill_set_passed: number;
  kill_set_total: number;
  sufficient_set_passed: number;
  sufficient_set_total: number;
  allowed_next?: string[];
  disallowed_next?: string[];
}

export interface ApiDiagnosisReport {
  id: string;
  conclusion: string;
  pivot_route?: string;
  levels: Array<{ level: string; name: string; status: string; finding?: string }>;
}

export interface ApiPhaseDetails {
  phase: string;
  active_runs?: ApiRun[];
  all_runs?: ApiRun[];
  refs?: Record<string, unknown>;
  checkpoints?: ApiHumanCheckpoint[];
  stories?: ApiStorySpine[];
  rqg?: ApiRQGReport[];
  diagnosis?: ApiDiagnosisReport[];
}

export interface ApiEntityRecord {
  id: string;
  kind: string;
  status: string;
  phase: string;
  title: string;
  created?: string;
  updated?: string;
}

/** API response shape from /api/all endpoint */
export interface ApiResponse {
  workflow: ApiWorkflow;
  entities: ApiEntities;
  entityRecords?: ApiEntityRecord[];
  timeline: ApiTimeline;
  journal: ApiJournal;
  activeRun: ApiActiveRun;
  /** Per-phase details for ALL phases (keyed by phase name) */
  phaseDetailsMap?: Record<string, ApiPhaseDetails>;
  phaseRuns?: ApiPhaseRunSummary[];
}

/** Lightweight phase run summary for topology view */
export interface ApiPhaseRunSummary {
  id: string;
  phase: string;
  status: string;
  created: string;
  updated: string;
  pivot?: {
    from: string;
    to: string;
    category: string;
    rationale: string;
  };
  inner_loop?: {
    state: string;
    round: number;
    attempts: number;
  };
}

/** Phase run card for topology display */
export interface PhaseRunCard {
  id: string;
  phase: PhaseName;
  status: "active" | "promoted" | "pivoted" | "aborted" | "blocked";
  created: string;
  updated: string;
  round: number;
  attempts: number;
  pivotTo?: PhaseName;
  pivotCategory?: string;
}

export interface MonitorData {
  projectId: string;
  projectName: string;
  /** Concise one-line project summary (≤60 chars) */
  projectSummary?: string;
  anchor?: string;
  currentPhase: PhaseName;
  phases: PhaseInfo[];
  entities: Entity[];
  entitySummaries: EntitySummaryData[];
  timeline: TimelineEvent[];
  journal: JournalEntry[];
  pivotEdges: PivotEdge[];
  phaseRunCards: PhaseRunCard[];
  lastUpdated: string;
}

// ── Research brief (from /api/brief endpoint) ────────────────────────────────

export interface BriefItem {
  text: string;
  phase?: string;
  severity?: "active" | "warning" | "human" | "promoted" | "pivoted" | "aborted";
  since?: string;
}

export interface ResearchBrief {
  generatedAt: string;
  project: string;
  currentPhase: string | null;
  summary: string;
  doing: BriefItem[];
  done: BriefItem[];
}

/** Operation envelope: original REST returned { ok, data }; operations keep the wrapper. */
export interface ApiEnvelope<T = ApiResponse> {
  ok: boolean;
  data?: T;
  error?: string;
}
