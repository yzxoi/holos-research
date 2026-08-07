import type { PhaseRun, StateYaml } from "./schema";
import { PHASE_ORDER } from "./schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Phase display names
// ---------------------------------------------------------------------------

const PHASE_DISPLAY: Record<string, string> = {
  explore: "Explore",
  ground: "Ground",
  design: "Design",
  realize: "Realize",
  experiment: "Experiment",
  compose: "Compose",
};

function phaseName(key: string): string {
  return PHASE_DISPLAY[key] ?? key;
}

// ---------------------------------------------------------------------------
// Inner-loop state descriptions
// ---------------------------------------------------------------------------

const LOOP_STATE_VERB: Record<string, string> = {
  attempt: "Working",
  evaluate: "Evaluating",
  decide: "Deciding next step",
  finished: "Finished",
  aborted: "Aborted",
};

// ---------------------------------------------------------------------------
// Default fallbacks for budget fields
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_MAX_STAGNATION = 2;

// ---------------------------------------------------------------------------
// Template renderers
// ---------------------------------------------------------------------------

export function renderActiveRun(run: PhaseRun): BriefItem {
  const phase = phaseName(run.phase);
  const loop = run.inner_loop;
  if (!loop)
    return {
      text: `Run ${run.id.slice(0, 12)}: no inner loop data`,
      phase: run.phase,
      severity: "active" as const,
      since: run.created,
    };
  const budget = loop.budget;
  const maxAttempts = budget?.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts = loop.attempts ?? 0;
  const round = loop.round ?? 1;
  const verb = LOOP_STATE_VERB[loop.state] ?? "Working";

  let text = `${verb} in ${phase} phase (attempt ${attempts}/${maxAttempts}, round ${round})`;

  if (loop.progress_metric) {
    const metric = loop.progress_metric;
    if (metric.current !== undefined && metric.previous !== undefined) {
      const delta = metric.current - metric.previous;
      const direction = delta >= 0 ? "up" : "down";
      text += `. ${metric.name}: ${metric.current} (${direction} from ${metric.previous})`;
    }
  }

  if (run.summary) {
    text += `. ${run.summary}`;
  }

  return {
    text,
    phase: run.phase,
    severity: "active",
    since: run.created,
  };
}

export function renderBlockedOn(blockedOn: string, state: StateYaml): BriefItem {
  const phase = state.focus?.phase ?? "unknown";
  return {
    text: `Blocked in ${phaseName(phase)} phase: ${blockedOn}`,
    phase,
    severity: "warning",
    since: state.focus?.since,
  };
}

export function renderPendingCheckpoint(run: PhaseRun, kind: string, question?: string): BriefItem {
  const phase = phaseName(run.phase);
  let text = `Awaiting human decision in ${phase} phase (${kind.replace(/_/g, " ")})`;
  if (question) {
    text += `: ${question}`;
  }
  return {
    text,
    phase: run.phase,
    severity: "human",
    since: run.updated,
  };
}

export function renderCompletedRun(run: PhaseRun): BriefItem {
  const phase = phaseName(run.phase);

  if (run.status === "promoted") {
    const nextIdx = PHASE_ORDER.indexOf(run.phase) + 1;
    const nextPhase = nextIdx < PHASE_ORDER.length ? phaseName(PHASE_ORDER[nextIdx]!) : "next phase";
    let text = `Completed ${phase} phase, promoted to ${nextPhase}`;
    if (run.summary) {
      text += `. ${run.summary}`;
    }
    return { text, phase: run.phase, severity: "promoted", since: run.updated };
  }

  if (run.status === "pivoted" && run.pivot) {
    const from = phaseName(run.pivot.from);
    const to = phaseName(run.pivot.to);
    const category = run.pivot.category.replace(/_/g, " ");
    let text = `Pivoted from ${from} to ${to} (${category})`;
    if (run.pivot.rationale) {
      text += `: ${run.pivot.rationale}`;
    }
    return { text, phase: run.phase, severity: "pivoted", since: run.updated };
  }

  if (run.status === "pivoted") {
    return {
      text: `Pivoted from ${phase} phase (details unavailable)`,
      phase: run.phase,
      severity: "pivoted" as const,
      since: run.updated,
    };
  }

  if (run.status === "aborted") {
    let text = `Aborted ${phase} phase`;
    if (run.summary) {
      text += `: ${run.summary}`;
    }
    return { text, phase: run.phase, severity: "aborted", since: run.updated };
  }

  // Fallback for any other terminal status
  return {
    text: `Finished ${phase} phase (${run.status})`,
    phase: run.phase,
    severity: "promoted",
    since: run.updated,
  };
}

export function renderSummary(
  doing: BriefItem[],
  done: BriefItem[],
  currentPhase: string | null,
  anchor: string | null,
): string {
  const parts: string[] = [];

  if (currentPhase) {
    parts.push(`Project is in ${phaseName(currentPhase)} phase`);
  } else {
    parts.push("Project has not started yet");
  }

  if (done.length > 0) {
    const promoted = done.filter((d) => d.severity === "promoted").length;
    const pivoted = done.filter((d) => d.severity === "pivoted").length;
    const aborted = done.filter((d) => d.severity === "aborted").length;

    const segments: string[] = [];
    if (promoted > 0) segments.push(`${promoted} phase${promoted > 1 ? "s" : ""} completed`);
    if (pivoted > 0) segments.push(`${pivoted} pivot${pivoted > 1 ? "s" : ""}`);
    if (aborted > 0) segments.push(`${aborted} aborted`);
    parts.push(segments.join(", "));
  }

  if (doing.length > 0) {
    const blocked = doing.some((d) => d.severity === "warning");
    const needsHuman = doing.some((d) => d.severity === "human");
    if (blocked) parts.push("currently blocked");
    else if (needsHuman) parts.push("awaiting human input");
    else parts.push("currently active");
  }

  return parts.join(". ") + ".";
}
