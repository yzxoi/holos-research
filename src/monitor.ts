import type { BriefItem, ResearchBrief } from "./brief-render";
import {
  renderActiveRun,
  renderBlockedOn,
  renderCompletedRun,
  renderPendingCheckpoint,
  renderSummary,
} from "./brief-render";
import { ResearchFS } from "./fs";
import { loadAllYaml, loadDiagnosisReports, resolveFocusRefs } from "./helpers";
import { ResearchJournal } from "./journal";
import { buildOverview } from "./overview";
import { PhaseRunManager } from "./phase-run";
import type {
  ClaimYaml,
  ExhibitYaml,
  ExperimentYaml,
  IdeaYaml,
  JournalNote,
  PaperYaml,
  PhaseRun,
  PlanYaml,
  RQGReport,
  StateYaml,
  StorySpine,
  SubmissionYaml,
  TimelineEvent,
} from "./schema";
import { PHASE_ORDER, type ProjectPhaseType } from "./schema";
import { ResearchTimeline } from "./timeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowStatus {
  current_phase: string | null;
  current_phase_since: string | null;
  blocked_on: string | null;
  phases: Array<{
    name: string;
    order: number;
    is_current: boolean;
    is_completed: boolean;
    is_pending: boolean;
  }>;
  anchor: string | null;
  /** Concise one-line project summary derived from anchor (≤60 chars) */
  project_summary: string | null;
  next: string | null;
}

export interface StorySpineDetail {
  id: string;
  idea_ref: string;
  status: string;
  field_assumption: string;
  pain_point: string;
  non_obvious_insight: string;
  candidate_paper_angles: Array<{ type: string; title_sketch: string }>;
  scores: Record<string, number>;
}

export interface RQGDetail {
  id: string;
  overall: string;
  kill_set_passed: number;
  kill_set_total: number;
  sufficient_set_passed: number;
  sufficient_set_total: number;
  allowed_next: string[];
  disallowed_next: string[];
}

export interface DiagnosisDetail {
  id: string;
  conclusion: string;
  pivot_route?: string;
  levels: Array<{ level: string; name: string; status: string; finding?: string }>;
}

export interface PhaseDetails {
  phase: string;
  active_runs: PhaseRun[];
  all_runs: PhaseRun[];
  refs: Record<string, unknown>;
  checkpoints: Array<{
    kind: string;
    status: string;
    question?: string;
    decision?: string;
    rationale?: string;
    brief_ref?: string;
    brief_generated_at?: string;
    resource_commitment?: any;
    waived_reason?: string;
  }>;
  stories?: StorySpineDetail[];
  rqg?: RQGDetail[];
  diagnosis?: DiagnosisDetail[];
}

export interface EntitySummary {
  counts: Record<string, number>;
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

export interface TimelinePreview {
  events: TimelineEvent[];
  count: number;
}

export interface JournalPreview {
  notes: JournalNote[];
  count: number;
}

export interface ActivePhaseRun {
  run: PhaseRun | null;
  state: StateYaml | null | undefined;
  context: {
    anchor: string | null;
    focus_summary: string | null;
    focus_next: string | null;
    blocked_on: string | null;
  };
}

export interface EntityRecord {
  id: string;
  kind: string;
  status: string;
  phase: string;
  title: string;
  created?: string;
  updated?: string;
}

// ---------------------------------------------------------------------------
// MonitorBoard
// ---------------------------------------------------------------------------

export class MonitorBoard {
  // ── Brief cache (per-project, 60s TTL) ────────────────────────────────────
  private briefCache = new Map<string, { data: ResearchBrief; at: number }>();
  private static BRIEF_TTL_MS = 60_000;

  // ── Request-level cache (TTL-based, reduces redundant file I/O) ────────────
  private cache = new Map<string, { data: any; expiry: number }>();
  private cacheKey(key: string): string {
    const projectKey = ResearchFS.resolve(".").replace(/\/$/, "");
    return `${projectKey}::${key}`;
  }
  async cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const ck = this.cacheKey(key);
    const entry = this.cache.get(ck);
    if (entry && Date.now() < entry.expiry) return entry.data as T;
    const data = await fn();
    this.cache.set(ck, { data, expiry: Date.now() + ttl });
    return data;
  }

  // ── State cache (per-project, short TTL to avoid repeated state.yaml reads) ─
  private stateCaches = new Map<string, { data: StateYaml | undefined; expiry: number }>();
  private static STATE_TTL_MS = 5_000;

  /** Generate a natural-language research brief. Cached per-project for 60s. */
  async generateBrief(projectDir?: string): Promise<ResearchBrief> {
    const cacheKey = projectDir ?? "default";
    const cached = this.briefCache.get(cacheKey);
    if (cached && Date.now() - cached.at < MonitorBoard.BRIEF_TTL_MS) {
      return cached.data;
    }

    const state = await this.loadState();
    const allRuns = await PhaseRunManager.list();

    // ── Doing ──────────────────────────────────────────────────────────────
    const doing: BriefItem[] = [];

    // Active runs
    const activeRuns = allRuns.filter((r) => r.status === "active");
    for (const run of activeRuns) {
      doing.push(renderActiveRun(run));
    }

    // Blocked on
    if (state?.focus?.blocked_on) {
      doing.push(renderBlockedOn(state.focus.blocked_on, state));
    }

    // Pending human checkpoints on active runs
    for (const run of activeRuns) {
      for (const cp of run.human_checkpoints) {
        if (cp.status === "pending") {
          doing.push(renderPendingCheckpoint(run, cp.kind, cp.question));
        }
      }
    }

    // ── Done ───────────────────────────────────────────────────────────────
    const done: BriefItem[] = [];
    const terminalRuns = allRuns
      .filter((r) => r.status === "promoted" || r.status === "pivoted" || r.status === "aborted")
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, 10);

    for (const run of terminalRuns) {
      done.push(renderCompletedRun(run));
    }

    // ── Summary ────────────────────────────────────────────────────────────
    const currentPhase = state?.focus?.phase ?? null;
    const anchor = state?.anchor ?? null;
    const summary = renderSummary(doing, done, currentPhase, anchor);

    const brief: ResearchBrief = {
      generatedAt: new Date().toISOString(),
      project: anchor ?? state?.project ?? "unknown",
      currentPhase,
      summary,
      doing,
      done,
    };

    this.briefCache.set(cacheKey, { data: brief, at: Date.now() });
    return brief;
  }

  /** Invalidate all caches (brief, request-level, state), either for a specific project or all projects. */
  invalidateBriefCache(projectDir?: string) {
    if (projectDir) {
      this.briefCache.delete(projectDir);
      const prefix = projectDir.replace(/\/$/, "");
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) this.cache.delete(key);
      }
      this.stateCaches.delete(prefix);
    } else {
      this.briefCache.clear();
      this.cache.clear();
      this.stateCaches.clear();
    }
  }

  /** Return the current workflow state across all 6 phases. */
  async getWorkflowStatus(): Promise<WorkflowStatus> {
    const state = await this.loadState();
    if (!state) {
      return {
        current_phase: null,
        current_phase_since: null,
        blocked_on: null,
        phases: PHASE_ORDER.map((name, i) => ({
          name,
          order: i + 1,
          is_current: false,
          is_completed: false,
          is_pending: i === 0,
        })),
        anchor: null,
        project_summary: null,
        next: null,
      };
    }

    const currentPhase = state.focus?.phase ?? null;
    const currentIdx = currentPhase ? PHASE_ORDER.indexOf(currentPhase) : -1;

    return {
      current_phase: currentPhase,
      current_phase_since: state.focus?.since ?? null,
      blocked_on: state.focus?.blocked_on ?? null,
      phases: PHASE_ORDER.map((name, i) => ({
        name,
        order: i + 1,
        is_current: name === currentPhase,
        is_completed: currentIdx !== -1 && i < currentIdx,
        is_pending: currentIdx !== -1 && i > currentIdx,
      })),
      anchor: state.anchor ?? null,
      project_summary: state.project_summary ?? this.generateProjectSummary(state.anchor ?? null),
      next: state.focus?.next ?? null,
    };
  }

  /** Return detailed info for a specific phase. */
  async getPhaseDetails(phase: string, preloadedRuns?: PhaseRun[]): Promise<PhaseDetails> {
    const allRuns = preloadedRuns ?? (await PhaseRunManager.list());
    const phaseRuns = allRuns.filter((r) => r.phase === phase);
    const activeRuns = phaseRuns.filter((r) => r.status === "active");

    // Collect checkpoints from all runs in this phase
    const checkpoints = phaseRuns.flatMap((r) =>
      r.human_checkpoints.map((cp) => ({
        kind: cp.kind,
        status: cp.status,
        question: cp.question,
        decision: cp.decision,
        rationale: cp.rationale,
        brief_ref: cp.brief_ref,
        brief_generated_at: cp.brief_generated_at,
        resource_commitment: cp.resource_commitment,
        waived_reason: cp.waived_reason,
      })),
    );

    // Merge refs from active runs
    let refs: Record<string, unknown> = {};
    for (const run of activeRuns) {
      refs = resolveFocusRefs(
        refs as Record<string, string | string[] | undefined>,
        run.refs as Record<string, string | string[] | undefined>,
      );
    }

    // Load phase-specific data conditionally based on phase
    let stories: StorySpineDetail[] | undefined;
    let rqg: RQGDetail[] | undefined;
    let diagnosis: DiagnosisDetail[] | undefined;

    if (phase === "explore" || phase === "ground") {
      const storyFiles = await ResearchFS.listYaml(ResearchFS.resolve("positioning"));
      stories = [];
      for (const file of storyFiles) {
        if (!file.endsWith(".story.yaml")) continue;
        const spine = await ResearchFS.readYaml<StorySpine>(ResearchFS.resolve("positioning", file));
        if (spine) {
          stories.push({
            id: spine.id ?? file,
            idea_ref: spine.idea_ref ?? "",
            status: spine.status ?? "proposed",
            field_assumption: spine.field_assumption ?? "",
            pain_point: spine.pain_point ?? "",
            non_obvious_insight: spine.non_obvious_insight ?? "",
            candidate_paper_angles: spine.candidate_paper_angles ?? [],
            scores: spine.scores ?? {},
          });
        }
      }
    }

    if (phase === "experiment") {
      // Load RQG reports
      const rqgFiles = await ResearchFS.listYaml(ResearchFS.resolve("rqg"));
      rqg = [];
      for (const file of rqgFiles) {
        const report = await ResearchFS.readYaml<RQGReport>(ResearchFS.resolve("rqg", file));
        if (report) {
          // audit#3 P1-2: defensive `?? []` — RQG YAMLs authored manually or
          // migrated from older schemas may omit kill_set / sufficient_set.
          // Without these guards, `.filter()` throws TypeError, propagating
          // as a 500 from /api/all and freezing the whole dashboard.
          const killSet = report.kill_set ?? [];
          const sufficientSet = report.sufficient_set ?? [];
          rqg.push({
            id: report.id ?? file,
            overall: report.overall ?? "unknown",
            kill_set_passed: killSet.filter((k) => k.passed).length,
            kill_set_total: killSet.length,
            sufficient_set_passed: sufficientSet.filter((k) => k.passed).length,
            sufficient_set_total: sufficientSet.length,
            allowed_next: report.allowed_next ?? [],
            disallowed_next: report.disallowed_next ?? [],
          });
        }
      }

      // Load Diagnosis reports
      const diagReports = await loadDiagnosisReports();
      diagnosis = diagReports.map((diagReport) => {
        // audit#3 P1-3: previously this collapsed to literal "pivot" even when
        // the recommended_decision was iterate/promote/abort. Pass through the
        // actual decision so the frontend renders the correct route label.
        const decision = diagReport.conclusion?.recommended_decision;
        return {
          id: diagReport.id,
          conclusion: decision ?? "pending",
          pivot_route: decision === "pivot" || decision === "abort" ? decision : undefined,
          levels: diagReport.levels
            ? Object.entries(diagReport.levels).map(([key, val]: [string, any]) => ({
                level: key,
                name: key.replace(/^L(\d)_/, (_, n) => `Level ${n}: `).replace(/_/g, " "),
                status: val.status ?? "pending",
                finding: val.evidence,
              }))
            : [],
        };
      });
    }

    return {
      phase,
      active_runs: activeRuns,
      all_runs: phaseRuns,
      refs,
      checkpoints,
      stories,
      rqg,
      diagnosis,
    };
  }

  /** Return counts and status of all entities. */
  async getEntitySummary(): Promise<EntitySummary> {
    const state = await this.loadState();
    if (!state) {
      return {
        counts: {},
        by_status: {},
        focus_refs: {
          experiments: [],
          claims: [],
          exhibits: [],
        },
      };
    }

    const ov = await buildOverview(state);
    return ov.entity_summary;
  }

  /** Return recent timeline events, optionally filtered. */
  async getTimelinePreview(opts: ResearchTimeline.QueryOptions = {}): Promise<TimelinePreview> {
    const last = opts.last ?? 20;
    const events = await ResearchTimeline.query({ ...opts, last });
    return { events, count: events.length };
  }

  /** Return recent journal notes. */
  async getJournalPreview(limit = 20): Promise<JournalPreview> {
    const notes = await ResearchJournal.queryNotes({ last: limit });
    return { notes, count: notes.length };
  }

  /** Return the currently active phase run with full context. */
  async getActivePhaseRun(): Promise<ActivePhaseRun> {
    const state = await this.loadState();
    if (!state?.focus?.active_phase_run) {
      return {
        run: null,
        state,
        context: {
          anchor: state?.anchor ?? null,
          focus_summary: state?.focus?.summary ?? null,
          focus_next: state?.focus?.next ?? null,
          blocked_on: state?.focus?.blocked_on ?? null,
        },
      };
    }

    const run = await PhaseRunManager.read(state.focus.active_phase_run);
    return {
      run: run ?? null,
      state,
      context: {
        anchor: state.anchor ?? null,
        focus_summary: state.focus.summary ?? null,
        focus_next: state.focus.next ?? null,
        blocked_on: state.focus.blocked_on ?? null,
      },
    };
  }

  /** Return per-entity records with id, kind, status, phase, title for the monitor board. */
  async getEntityRecords(): Promise<EntityRecord[]> {
    const [ideas, plans, experiments, claims, exhibits, papers, submissions] = await Promise.all([
      loadAllYaml<IdeaYaml>("ideas"),
      loadAllYaml<PlanYaml>("plans"),
      loadAllYaml<ExperimentYaml>("experiments"),
      loadAllYaml<ClaimYaml>("claims"),
      loadAllYaml<ExhibitYaml>("exhibits"),
      loadAllYaml<PaperYaml>("manuscripts"),
      loadAllYaml<SubmissionYaml>("submissions"),
    ]);

    const records: EntityRecord[] = [];

    for (const e of ideas) {
      // Ideas: proposed/exploring = explore; grounding/selected/parked/rejected = ground
      const phase: ProjectPhaseType = ["grounding", "selected", "parked", "rejected"].includes(e.status)
        ? "ground"
        : "explore";
      records.push({ id: e.id, kind: "idea", status: e.status, phase, title: e.title, created: e.created });
    }
    for (const e of plans) {
      // Plans: draft/refining = design; active/approved/superseded/cancelled = realize
      const phase: ProjectPhaseType = e.status === "draft" || e.status === "refining" ? "design" : "realize";
      records.push({ id: e.id, kind: "plan", status: e.status, phase, title: e.title, created: e.created });
    }
    for (const e of experiments) {
      records.push({
        id: e.id,
        kind: "experiment",
        status: e.status,
        phase: "experiment",
        title: e.title,
        created: e.created,
        updated: e.updated,
      });
    }
    for (const e of claims) {
      records.push({ id: e.id, kind: "claim", status: e.status, phase: "compose", title: e.title, created: e.created });
    }
    for (const e of exhibits) {
      records.push({
        id: e.id,
        kind: "exhibit",
        status: e.status,
        phase: "compose",
        title: e.title,
        created: e.created,
      });
    }
    for (const e of papers) {
      records.push({ id: e.id, kind: "paper", status: e.status, phase: "compose", title: e.title, created: e.created });
    }
    for (const e of submissions) {
      records.push({
        id: e.id,
        kind: "submission",
        status: e.status,
        phase: "compose",
        title: e.title,
        created: e.created,
      });
    }

    return records;
  }

  // ── Project summary generation ────────────────────────────────────────────

  /** Cache for project summaries (keyed by anchor text, long TTL since anchors rarely change) */
  private summaryCache = new Map<string, { summary: string; at: number }>();
  private static SUMMARY_TTL_MS = 300_000; // 5 minutes

  /**
   * Generate a concise one-line project summary from the anchor text.
   *
   * Strategy:
   * 1. If anchor contains Chinese colon (：), take the clause after it — the part
   *    before the colon is typically a label/competition name, after is the real description
   * 2. Cut at the first sentence-ending separator (。or newline)
   * 3. If result is still >60 chars, truncate at the last minor separator (，,；;)
   * 4. Final hard-truncate to 60 chars with ellipsis
   *
   * Cached for 5 minutes keyed on the anchor text itself.
   */
  generateProjectSummary(anchor: string | null): string | null {
    if (!anchor) return null;

    const cached = this.summaryCache.get(anchor);
    if (cached && Date.now() - cached.at < MonitorBoard.SUMMARY_TTL_MS) {
      return cached.summary;
    }

    let summary = anchor;

    // Step 1: Prefer the clause after Chinese colon — it's the real description
    const colonIdx = summary.indexOf("：");
    if (colonIdx >= 0 && colonIdx < summary.length - 2) {
      summary = summary.slice(colonIdx + 1).trim();
    }

    // Step 2: Cut at first sentence-ending separator (。or newline)
    const endPats = [/[。\n]/];
    for (const pat of endPats) {
      const m = summary.search(pat);
      if (m > 4 && m < summary.length - 2) {
        summary = summary.slice(0, m).trim();
        break;
      }
    }

    // Step 3: If still >60 chars, progressively cut at the last minor separator
    //         before the 60-char boundary, repeating if necessary
    while (summary.length > 60) {
      const minorSeps = /[，,；;]/;
      let lastCut = -1;
      for (let i = 0; i < summary.length && i < 80; i++) {
        if (minorSeps.test(summary[i]!)) lastCut = i;
      }
      if (lastCut > 8) {
        summary = summary.slice(0, lastCut).trim();
      } else {
        // No good comma break — try breaking at a space (for English-heavy text)
        const spaceIdx = summary.lastIndexOf(" ", 58);
        if (spaceIdx > 10) {
          summary = summary.slice(0, spaceIdx).trim();
        }
        break; // avoid infinite loop if no separator found
      }
    }

    // Step 4: Hard truncate
    if (summary.length > 60) {
      summary = summary.slice(0, 57).trim() + "...";
    }

    this.summaryCache.set(anchor, { summary, at: Date.now() });
    return summary;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async loadState(): Promise<StateYaml | undefined> {
    const projectKey = ResearchFS.resolve(".").replace(/\/$/, "");
    const entry = this.stateCaches.get(projectKey);
    if (entry && Date.now() < entry.expiry) return entry.data;
    const data = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
    this.stateCaches.set(projectKey, { data, expiry: Date.now() + MonitorBoard.STATE_TTL_MS });
    return data;
  }
}
