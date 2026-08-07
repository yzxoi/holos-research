import { countBy, loadAllYaml } from "./helpers";
import { log } from "./log";
import type {
  ClaimYaml,
  ExhibitYaml,
  ExperimentYaml,
  IdeaYaml,
  PaperYaml,
  PlanYaml,
  StateYaml,
  SubmissionYaml,
} from "./schema";
import { ResearchTimeline } from "./timeline";
import { entityMdPath } from "./tools/shared";

// ── Overview types ───────────────────────────────────────────────────────────

export interface OverviewPipeline {
  idea: { id: string; title: string; status: string } | null;
  plan: { id: string; title: string; status: string } | null;
  experiments: { total: number; by_status: Record<string, number> };
  claims: { total: number; by_status: Record<string, number> };
  exhibits: { total: number; by_status: Record<string, number> };
  paper: { id: string; title: string; status: string; sections_bound: number; sections_total: number } | null;
  submission: { id: string; title: string; status: string; venue: string | null } | null;
}

export interface OverviewGaps {
  orphan_experiments: Array<{ id: string; md_path: string }>;
  unanalyzed_experiments: Array<{ id: string; md_path: string }>;
  weak_claims: Array<{ id: string; md_path: string }>;
  unbound_paper_sections: string[];
  stalled: Array<{ id: string; status: string; since: string; md_path: string }>;
}

export interface OverviewEntitySummary {
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
  /** Present only when state counters diverge from actual file counts */
  _counter_drift?: string[];
}

export interface OverviewResult {
  project: string;
  anchor: string | null;
  phase: string | null;
  phase_since: string | null;
  pipeline: OverviewPipeline;
  gaps: OverviewGaps;
  entity_summary: OverviewEntitySummary;
}

// ── Build overview ───────────────────────────────────────────────────────────

/** Build the overview data by reading all entity directories. */
export async function buildOverview(state: StateYaml): Promise<OverviewResult> {
  const refs = state.focus?.refs;
  const stalledDays = state.config.stalled_days ?? 7;

  // ── Load all entities in parallel ──
  const [ideas, plans, experiments, claims, exhibits, papers, submissions] = await Promise.all([
    loadAllYaml<IdeaYaml>("ideas"),
    loadAllYaml<PlanYaml>("plans"),
    loadAllYaml<ExperimentYaml>("experiments", (f) => !f.endsWith(".diagnosis.yaml")),
    loadAllYaml<ClaimYaml>("claims"),
    loadAllYaml<ExhibitYaml>("exhibits"),
    loadAllYaml<PaperYaml>("manuscripts"),
    loadAllYaml<SubmissionYaml>("submissions"),
  ]);

  // ── Pipeline trace ──
  const findEntity = <T extends { id: string }>(list: T[], id: string | undefined): T | undefined =>
    id ? list.find((e) => e.id === id) : undefined;

  const ideaRef = findEntity(ideas, refs?.idea_ref);
  const planRef = findEntity(plans, refs?.plan_ref);
  const paperRef = findEntity(papers, refs?.paper_ref);
  const subRef = findEntity(submissions, refs?.submission_ref);

  // Build a set of claim IDs bound to the paper for section analysis
  const paperBoundClaims = new Set(paperRef?.claims ?? []);
  // Build a set of section names that have a bound claim pointing to them
  const boundSections = new Set<string>();
  for (const claim of claims) {
    if (paperBoundClaims.has(claim.id) && claim.paper_section) {
      boundSections.add(claim.paper_section);
    }
  }

  const pipeline: OverviewPipeline = {
    idea: ideaRef ? { id: ideaRef.id, title: ideaRef.title, status: ideaRef.status } : null,
    plan: planRef ? { id: planRef.id, title: planRef.title, status: planRef.status } : null,
    experiments: { total: experiments.length, by_status: countBy(experiments, (e) => e.status) },
    claims: { total: claims.length, by_status: countBy(claims, (c) => c.status) },
    exhibits: { total: exhibits.length, by_status: countBy(exhibits, (e) => e.status) },
    paper: paperRef
      ? {
          id: paperRef.id,
          title: paperRef.title,
          status: paperRef.status,
          sections_bound: boundSections.size,
          sections_total: paperRef.sections?.length ?? 0,
        }
      : null,
    submission: subRef
      ? { id: subRef.id, title: subRef.title, status: subRef.status, venue: subRef.venue ?? null }
      : null,
  };

  // ── Gap analysis ──

  // Orphan experiments: no plan and no idea link
  const orphanExperiments = experiments
    .filter((e) => !e.plan_ref && !e.idea_ref)
    .map((e) => ({ id: e.id, md_path: entityMdPath(e.id) }));

  // Unanalyzed experiments: completed but not referenced by any claim's evidence
  const citedExperiments = new Set(claims.flatMap((c) => c.evidence?.map((ev) => ev.ref) ?? []));
  const unanalyzedExperiments = experiments
    .filter((e) => e.status === "completed" && !citedExperiments.has(e.id))
    .map((e) => ({ id: e.id, md_path: entityMdPath(e.id) }));

  // Weak claims: status is weak or candidate
  const weakClaims = claims
    .filter((c) => c.status === "weak" || c.status === "candidate")
    .map((c) => ({ id: c.id, md_path: entityMdPath(c.id) }));

  // Unbound paper sections: sections in the paper whose name doesn't match
  // any bound claim's paper_section
  const unboundSections = (paperRef?.sections ?? []).filter((s) => !boundSections.has(s.name)).map((s) => s.name);

  // Stalled entities: non-terminal entities with no timeline activity in 7+ days
  // Use timeline to find last update per entity
  const stalledCutoffMs = Date.now() - stalledDays * 24 * 60 * 60 * 1000;

  const timelineEvents = await ResearchTimeline.query();
  const lastActivityByEntity = new Map<string, number>();
  for (const ev of timelineEvents) {
    if (ev.id) {
      const ts = new Date(ev.ts).getTime();
      const existing = lastActivityByEntity.get(ev.id);
      if (!existing || ts > existing) {
        lastActivityByEntity.set(ev.id, ts);
      }
    }
  }

  const terminalStatuses = new Set([
    "selected",
    "parked",
    "rejected", // idea
    "superseded",
    "cancelled", // plan
    "completed",
    "failed",
    "invalidated",
    "stopped", // experiment
    "retracted",
    "final", // claim
    "approved",
    "superseded",
    "dropped", // exhibit
    "frozen",
    "archived", // paper
    "accepted",
    "rejected",
    "closed", // submission
  ]);

  const allNonTerminal = [
    ...ideas.filter((i) => !terminalStatuses.has(i.status)),
    ...plans.filter((p) => !terminalStatuses.has(p.status)),
    ...experiments.filter((e) => !terminalStatuses.has(e.status)),
    ...claims.filter((c) => !terminalStatuses.has(c.status)),
    ...exhibits.filter((ex) => !terminalStatuses.has(ex.status)),
    ...papers.filter((p) => !terminalStatuses.has(p.status)),
    ...submissions.filter((s) => !terminalStatuses.has(s.status)),
  ];

  const stalled: OverviewGaps["stalled"] = [];
  for (const entity of allNonTerminal) {
    const lastActivityMs = lastActivityByEntity.get(entity.id) ?? new Date(entity.created).getTime();
    if (lastActivityMs < stalledCutoffMs) {
      stalled.push({
        id: entity.id,
        status: entity.status,
        since: new Date(lastActivityMs).toISOString(),
        md_path: entityMdPath(entity.id),
      });
    }
  }

  const gaps: OverviewGaps = {
    orphan_experiments: orphanExperiments,
    unanalyzed_experiments: unanalyzedExperiments,
    weak_claims: weakClaims,
    unbound_paper_sections: unboundSections,
    stalled,
  };

  return {
    project: state.project,
    anchor: state.anchor ?? null,
    phase: state.focus?.phase ?? null,
    phase_since: state.focus?.since ?? null,
    pipeline,
    gaps,
    entity_summary: {
      counts: {
        ideas: ideas.length,
        plans: plans.length,
        experiments: experiments.length,
        claims: claims.length,
        exhibits: exhibits.length,
        papers: papers.length,
        submissions: submissions.length,
      },
      // Counter drift detection: warn if state counters don't match actual file counts
      _counter_drift: (() => {
        const c = state.counters;
        const drifts: string[] = [];
        if (c.idea !== ideas.length) drifts.push(`idea: counter=${c.idea} actual=${ideas.length}`);
        if (c.plan !== plans.length) drifts.push(`plan: counter=${c.plan} actual=${plans.length}`);
        if (c.exp !== experiments.length) drifts.push(`exp: counter=${c.exp} actual=${experiments.length}`);
        if (c.claim !== claims.length) drifts.push(`claim: counter=${c.claim} actual=${claims.length}`);
        if (c.exh !== exhibits.length) drifts.push(`exh: counter=${c.exh} actual=${exhibits.length}`);
        if (c.paper !== papers.length) drifts.push(`paper: counter=${c.paper} actual=${papers.length}`);
        if (c.sub !== submissions.length) drifts.push(`sub: counter=${c.sub} actual=${submissions.length}`);
        if (drifts.length > 0) log.warn("CounterDrift", `State counters diverged from actual: ${drifts.join(", ")}`);
        return drifts.length > 0 ? drifts : undefined;
      })(),
      by_status: {
        ideas: countBy(ideas, (e) => e.status),
        plans: countBy(plans, (e) => e.status),
        experiments: countBy(experiments, (e) => e.status),
        claims: countBy(claims, (c) => c.status),
        exhibits: countBy(exhibits, (e) => e.status),
        papers: countBy(papers, (e) => e.status),
        submissions: countBy(submissions, (e) => e.status),
      },
      focus_refs: {
        idea: refs?.idea_ref,
        plan: refs?.plan_ref,
        experiments: refs?.experiment_refs ?? [],
        claims: refs?.claim_refs ?? [],
        exhibits: refs?.exhibit_refs ?? [],
        paper: refs?.paper_ref,
        submission: refs?.submission_ref,
      },
    },
  };
}
