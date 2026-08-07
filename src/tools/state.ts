import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { ResearchFS } from "../fs";
import { resolveFocusRefs as mergeFocusRefs } from "../helpers";
import { getMutex, withLock } from "../lock";
import { log } from "../log";
import { buildOverview, type OverviewResult } from "../overview";
import type { StateYaml, TimelineEvent } from "../schema";
import {
  type CheckpointKind,
  ComposeConfig,
  DesignConfig,
  ExperimentConfig,
  ExplorationConfig,
  GroundConfig,
  ParticipationMode,
  PHASE_ORDER,
  ProjectPhase,
  type ProjectPhaseType,
  RealizeConfig,
  ResourceCommitment,
  StateYaml as StateYamlSchema,
  VALID_CHECKPOINT_KINDS,
} from "../schema";
import { ResearchTimeline } from "../timeline";
import { mdMeta, notInitialized, withGuard } from "./shared";

const stateMutex = getMutex("state");
const agentsMdMutex = getMutex("agents_md");

import path from "path";
import { scopeDir } from "../ctx";
import { ResearchJournal } from "../journal";
import { PhaseRunManager } from "../phase-run";
import { SnapshotManager } from "../snapshot";
import { generateAgentsMd, updateAgentsMdDynamic } from "./agents-md";

// ── Checkpoint injection lookup ────────────────────────────────────────────────
// Maps (fromPhase, toPhase) transition pairs to the checkpoints that must be
// injected before the transition is allowed.  Each entry carries the full
// addCheckpoint payload so adding a new transition is a one-line edit.

interface CheckpointInjection {
  kind: CheckpointKind;
  question: string;
  resource_commitment?: ResourceCommitment;
}

type PhaseTransitionKey = `${ProjectPhaseType}_${ProjectPhaseType}`;

const CHECKPOINT_INJECTIONS: ReadonlyMap<PhaseTransitionKey, CheckpointInjection[]> = new Map([
  [
    "explore_ground",
    [
      {
        kind: "taste_selection",
        question: "Confirm the selected idea aligns with taste and research direction before grounding.",
      },
    ],
  ],
  [
    "ground_design",
    [
      {
        kind: "taste_selection",
        question: "Confirm the grounded positioning has flavor and the paper path is viable.",
      },
      {
        kind: "reasonableness_check",
        question: "Is the contribution boundary clear enough to design a method around?",
      },
    ],
  ],
  [
    "design_realize",
    [
      { kind: "reasonableness_check", question: "Is the mechanism reasonable and worth implementing?" },
      {
        kind: "resource_commitment",
        question:
          "Declare compute resource requirements and confirm availability. Specify GPU type (4090/H100/H200), count, and connection preference (rtunnel for interactive, holos-inspire for managed). You MUST provide the actual resource_commitment with the real GPU type and count — the default below is a placeholder, NOT a recommendation.",
        resource_commitment: {
          resource_spec: { gpu_type: "OTHER", gpu_count: 1, nodes: 1, estimated_gpu_hours: 40 },
          connection_method: "local",
          budget_approved: false,
        },
      },
    ],
  ],
  [
    "realize_experiment",
    [
      {
        kind: "resource_commitment",
        question:
          "Confirm experimental compute budget. You MUST provide the actual resource_commitment with the real GPU type and count based on your knowledge of the compute environment — the default below is a placeholder, NOT a recommendation. Do NOT blindly approve the default.",
        resource_commitment: {
          resource_spec: { gpu_type: "OTHER", gpu_count: 1, nodes: 1, estimated_gpu_hours: 40 },
          connection_method: "local",
          budget_approved: false,
        },
      },
    ],
  ],
  [
    "experiment_compose",
    [
      {
        kind: "paper_ambition",
        question: "Confirm the experimental results support the intended paper ambition before composing.",
      },
    ],
  ],
]);

const DESCRIPTION = `Manage the project-level research state machine (state.yaml).

This tool controls the single project-level state machine that answers: "Where is this research right now, and why?"

## Actions

- **action="read"**: Return full state — project name, config (participation_mode, venue, exploration), counters for all 7 entity types, and focus (phase, summary, reason, refs, blocked_on, next). Use at session start to orient yourself.

- **action="advance"**: Move to the next adjacent phase in the main chain: explore → ground → design → realize → experiment → compose. Requires target_phase. The target must be exactly the next phase in sequence. Also works when no focus is set — use advance(target_phase="explore") to enter the first phase. Auto-appends focus.changed to timeline.

- **action="redirect"**: Jump to any phase, including non-adjacent ones. Used for rollbacks (e.g. compose → experiment when claims need more evidence) or skips when justified. Requires target_phase and reason. Auto-appends focus.changed to timeline.

- **action="block"**: Mark the current phase as blocked. Requires blocked_on (a human-readable description of the blocker, e.g. "Waiting for exp_007 results on Inspire"). Auto-appends focus.changed to timeline.

- **action="resume"**: Clear blocked status. Optionally update next to describe what to do now. Auto-appends focus.changed to timeline.

- **action="brief"**: Generate a handoff brief and update AGENTS.md at the project root. Reads state.yaml + the last 20 timeline events and updates the dynamic state section in AGENTS.md (which is auto-loaded by Synergy on every session start). Returns the generated brief text. Use this before ending a session or when handing off to another agent.

- **action="overview"**: Return a global project dashboard — pipeline trace, gap analysis, and recent timeline summary. Pure read, no writes. Use this at session start for multi-month projects where you need to quickly re-orient across the full pipeline rather than calling individual list actions.

- **action="confirm_checkpoint"**: Confirm a pending human checkpoint. Requires checkpoint_kind (which checkpoint to confirm) and decision (the human's decision). Optionally provide rationale. Resolves the checkpoint and creates a snapshot.

- **action="waive_checkpoint"**: Waive a pending human checkpoint. Requires checkpoint_kind (which checkpoint to waive) and reason (why it's being waived). Resolves the checkpoint without confirmation.

- **action="inner_loop_transition"**: Transition the inner loop state machine (attempt → evaluate → decide, etc.). Requires target_state. Validates the transition and logs a warning for non-standard paths.

- **action="record_decision"**: Record a decision from the inner loop decide step. Requires decision (iterate, promote, pivot, or abort). Optionally provide summary. Advances the round if iterating, or transitions inner_loop to a terminal state.

- **action="abort"**: Abort the current phase run and clear focus. Optionally provide reason. Calls PhaseRunManager.abort() on the active run and sets focus to undefined. Use this to abandon the current phase entirely.

## Phase transitions

Forward (advance): explore → ground → design → realize → experiment → compose

Common rollbacks (redirect): ground→explore (novelty collapsed), design→ground (contribution unclear), realize→design (method broken), experiment→realize (evidence gaps), compose→experiment (unsupported claims).

## When to use each action

- Starting a session: overview (for full context) or read (for state only)
- First time after init: advance(target_phase="explore") — but note that research_init already sets focus to explore, so this is only needed if focus was cleared
- Research naturally progressing: advance
- Reviewer feedback forcing a retreat: redirect with reason
- Waiting on compute/data/human input: block
- Blocker resolved: resume
- Ending a session or handing off: brief

## Config updates

Use participation_mode and venue params on any action to update top-level config. Use the phase_config param to update phase-specific settings (deep merged). These are applied before the action executes.

Example: research_state(action="read", phase_config={design: {max_review_rounds: 8}, experiment: {monitor_interval: "1h"}})

All phase config fields have sensible defaults. Users never need to set them upfront — adjust only when the default behavior doesn't fit.

Files: .research/state.yaml + AGENTS.md (for brief action)`;

type FocusRefs = NonNullable<NonNullable<StateYaml["focus"]>["refs"]>;

function buildRefsArray(refs: FocusRefs | undefined): string[] {
  if (!refs) return [];
  const out: string[] = [];
  if (refs.idea_ref) out.push(refs.idea_ref);
  if (refs.plan_ref) out.push(refs.plan_ref);
  if (refs.experiment_refs?.length) out.push(...refs.experiment_refs);
  if (refs.claim_refs?.length) out.push(...refs.claim_refs);
  if (refs.exhibit_refs?.length) out.push(...refs.exhibit_refs);
  if (refs.paper_ref) out.push(refs.paper_ref);
  if (refs.submission_ref) out.push(refs.submission_ref);
  return [...new Set(out)];
}

/** Resolve refs by merging state.focus.refs with phase_run refs (run overrides). */
async function resolveFocusRefs(state: StateYaml): Promise<FocusRefs | undefined> {
  if (!state.focus) return undefined;
  const runId = state.focus.active_phase_run;
  let runRefs: FocusRefs | undefined;
  if (runId) {
    const run = await PhaseRunManager.read(runId);
    if (run?.refs) runRefs = run.refs as FocusRefs;
  }
  const merged = mergeFocusRefs(state.focus.refs, runRefs);
  if (Object.keys(merged).length === 0) return undefined;
  return merged as FocusRefs;
}

/** Build snapshot refs from state and focus refs. */
async function buildSnapshotRefs(state: StateYaml): Promise<Record<string, string>> {
  const refs: Record<string, string> = {
    state: "state.yaml",
  };

  if (state.focus?.active_phase_run) {
    refs.phase_run = `phase_runs/${state.focus.active_phase_run}.yaml`;
  }

  const focusRefs = await resolveFocusRefs(state);
  if (focusRefs?.plan_ref) {
    refs.plan_ref = `plans/${focusRefs.plan_ref}.yaml`;
  }

  return refs;
}

async function formatState(state: StateYaml): Promise<string> {
  const lines = [
    "=== Research State ===",
    "",
    `Project: ${state.project}`,
    ...(state.anchor ? [`Anchor: ${state.anchor}`] : [`Anchor: (not set)`]),
    ...(state.project_summary ? [`Summary: ${state.project_summary}`] : []),
    `Venue: ${state.config.venue ?? "(not set)"}`,
    `Mode: ${state.config.participation_mode}`,
    "",
    "Phase Config:",
    `  explore:     depth=${state.config.exploration.depth}, pilot=${state.config.exploration.pilot}, max_refine_rounds=${state.config.exploration.max_refine_rounds}, idea_select_score=${state.config.exploration.idea_select_score}, idea_generators=${state.config.exploration.idea_generators}`,
    `  ground:      max_review_rounds=${state.config.ground.max_review_rounds}, max_closest_works=${state.config.ground.max_closest_works}`,
    `  design:      max_review_rounds=${state.config.design.max_review_rounds}, score_threshold=${state.config.design.score_threshold}, max_primary_claims=${state.config.design.max_primary_claims}, max_new_components=${state.config.design.max_new_components}`,
    `  realize:     max_review_rounds=${state.config.realize.max_review_rounds}, code_review_threshold=${state.config.realize.code_review_threshold}, require_sanity_contract=${state.config.realize.require_sanity_contract}, require_quality_contract=${state.config.realize.require_quality_contract}`,
    `  experiment:  max_optimize_rounds=${state.config.experiment.max_optimize_rounds}, monitor_interval=${state.config.experiment.monitor_interval}, significance_level=${state.config.experiment.significance_level}, min_seeds=${state.config.experiment.min_seeds}, regression_tolerance=${state.config.experiment.regression_tolerance}`,
    `  compose:     max_revise_rounds=${state.config.compose.max_revise_rounds}`,
    "",
    "Counters:",
    `  Ideas: ${state.counters.idea}`,
    `  Plans: ${state.counters.plan}`,
    `  Experiments: ${state.counters.exp}`,
    `  Claims: ${state.counters.claim}`,
    `  Exhibits: ${state.counters.exh}`,
    `  Papers: ${state.counters.paper}`,
    `  Submissions: ${state.counters.sub}`,
  ];

  if (state.focus) {
    lines.push(
      "",
      "Focus:",
      `  Phase: ${state.focus.phase}`,
      `  Since: ${state.focus.since}`,
      ...(state.focus.summary ? [`  Summary: ${state.focus.summary}`] : []),
      ...(state.focus.reason ? [`  Reason: ${state.focus.reason}`] : []),
      ...(state.focus.next ? [`  Next: ${state.focus.next}`] : []),
      ...(state.focus.blocked_on ? [`  ⚠ Blocked on: ${state.focus.blocked_on}`] : []),
    );
    const refs = buildRefsArray(await resolveFocusRefs(state));
    if (refs.length) lines.push(`  Refs: ${refs.join(", ")}`);
  } else {
    lines.push("", "Focus: (not set)");
  }

  return lines.join("\n");
}

function buildFocusRefs(
  params: {
    refs_idea?: string;
    refs_plan?: string;
    refs_experiments?: string[];
    refs_claims?: string[];
    refs_exhibits?: string[];
    refs_paper?: string;
    refs_submission?: string;
  },
  prev?: NonNullable<StateYaml["focus"]>,
): FocusRefs {
  return {
    idea_ref: params.refs_idea ?? prev?.refs?.idea_ref,
    plan_ref: params.refs_plan ?? prev?.refs?.plan_ref,
    experiment_refs: params.refs_experiments ?? prev?.refs?.experiment_refs,
    claim_refs: params.refs_claims ?? prev?.refs?.claim_refs,
    exhibit_refs: params.refs_exhibits ?? prev?.refs?.exhibit_refs,
    paper_ref: params.refs_paper ?? prev?.refs?.paper_ref,
    submission_ref: params.refs_submission ?? prev?.refs?.submission_ref,
  };
}

async function formatBrief(state: StateYaml, events: TimelineEvent[]): Promise<string> {
  const sections: string[] = [];

  sections.push(`# ${state.project}`);
  sections.push("");
  sections.push(`> Generated ${new Date().toISOString()}`);
  sections.push("");

  sections.push("## Project");
  sections.push("");
  sections.push(`- **Venue**: ${state.config.venue ?? "(not set)"}`);
  sections.push(`- **Anchor**: ${state.anchor ?? "(not set)"}`);
  sections.push(`- **Mode**: ${state.config.participation_mode}`);
  sections.push(`- **Created**: ${state.created}`);
  sections.push(
    `- **Entities**: ${state.counters.idea} ideas, ${state.counters.plan} plans, ${state.counters.exp} experiments, ${state.counters.claim} claims, ${state.counters.exh} exhibits, ${state.counters.paper} papers, ${state.counters.sub} submissions`,
  );
  sections.push("");

  sections.push("## Current Phase");
  sections.push("");
  if (state.focus) {
    sections.push(`**${state.focus.phase}** (since ${state.focus.since})`);
    if (state.focus.summary) sections.push(``);
    if (state.focus.summary) sections.push(state.focus.summary);
    if (state.focus.reason) {
      sections.push("");
      sections.push(`**Why here**: ${state.focus.reason}`);
    }
    if (state.focus.blocked_on) {
      sections.push("");
      sections.push(`⚠ **Blocked on**: ${state.focus.blocked_on}`);
    }
  } else {
    sections.push("No focus set yet.");
  }
  sections.push("");

  sections.push("## Recent Activity");
  sections.push("");
  if (events.length === 0) {
    sections.push("No timeline events yet.");
  } else {
    for (const event of events) {
      const id = event.id ? ` (${event.id})` : "";
      const summary = event.summary ?? event.type;
      sections.push(`- \`${event.ts.slice(0, 19)}\` **${event.type}**${id}: ${summary}`);
    }
  }
  sections.push("");

  sections.push("## Key References");
  sections.push("");
  const refs = await resolveFocusRefs(state);
  if (refs) {
    const entries: string[] = [];
    if (refs.idea_ref) entries.push(`- **Idea**: ${refs.idea_ref}`);
    if (refs.plan_ref) entries.push(`- **Plan**: ${refs.plan_ref}`);
    if (refs.experiment_refs?.length) entries.push(`- **Experiments**: ${refs.experiment_refs.join(", ")}`);
    if (refs.claim_refs?.length) entries.push(`- **Claims**: ${refs.claim_refs.join(", ")}`);
    if (refs.exhibit_refs?.length) entries.push(`- **Exhibits**: ${refs.exhibit_refs.join(", ")}`);
    if (refs.paper_ref) entries.push(`- **Paper**: ${refs.paper_ref}`);
    if (refs.submission_ref) entries.push(`- **Submission**: ${refs.submission_ref}`);
    if (entries.length) {
      sections.push(...entries);
    } else {
      sections.push("No references set.");
    }
  } else {
    sections.push("No references set.");
  }
  sections.push("");

  sections.push("## Next Steps");
  sections.push("");
  if (state.focus?.next) {
    sections.push(state.focus.next);
  } else {
    sections.push("(not specified)");
  }
  sections.push("");

  return sections.join("\n");
}

// ── Handler context ────────────────────────────────────────────────────────────

interface StateHandlerContext {
  state: StateYaml;
  statePath: string;
}

interface LoadAndPrepareStateParams {
  participation_mode?: "collaborative" | "guided" | "autonomous";
  venue?: string;
  phase_config?: {
    stalled_days?: number;
    exploration?: Record<string, unknown>;
    ground?: Record<string, unknown>;
    design?: Record<string, unknown>;
    realize?: Record<string, unknown>;
    experiment?: Record<string, unknown>;
    compose?: Record<string, unknown>;
  };
  anchor?: string;
  project_summary?: string;
}

/** Load state, backfill config, apply param updates (participation_mode, venue, phase_config, anchor). */
async function loadAndPrepareState(
  params: LoadAndPrepareStateParams,
): Promise<{ state: StateYaml; statePath: string } | null> {
  if (!(await ResearchFS.isInitialized())) return null;

  const statePath = ResearchFS.resolve("state.yaml");
  const state = await ResearchFS.readYaml<StateYaml>(statePath, StateYamlSchema);
  if (!state) return null;

  // Backfill missing config sections for backward compat with old state files
  if (!state.config.stalled_days && state.config.stalled_days !== 0) state.config.stalled_days = 7;
  state.config.exploration = ExplorationConfig.parse(state.config.exploration ?? {});
  state.config.ground = GroundConfig.parse(state.config.ground ?? {});
  state.config.design = DesignConfig.parse(state.config.design ?? {});
  state.config.realize = RealizeConfig.parse(state.config.realize ?? {});
  state.config.experiment = ExperimentConfig.parse(state.config.experiment ?? {});
  state.config.compose = ComposeConfig.parse(state.config.compose ?? {});

  let needsWrite = false;

  // Version-driven migration
  if (!state.schema_version || state.schema_version < 2) {
    // Migrate legacy state
    if ((state.config as any).spec && !(state.config as any).design) {
      state.config.design = DesignConfig.parse((state.config as any).spec);
      delete (state.config as any).spec;
    }
    if (state.focus?.phase === ("spec" as any)) {
      state.focus!.phase = "design";
    }
    state.schema_version = 2;
    needsWrite = true;
  }

  if (params.participation_mode) state.config.participation_mode = params.participation_mode;
  if (params.venue !== undefined) state.config.venue = params.venue || undefined;

  // Deep merge phase config
  if (params.phase_config) {
    const pc = params.phase_config;
    if (pc.stalled_days !== undefined) state.config.stalled_days = pc.stalled_days;
    if (pc.exploration) Object.assign(state.config.exploration, pc.exploration);
    if (pc.ground) Object.assign(state.config.ground, pc.ground);
    if (pc.design) Object.assign(state.config.design, pc.design);
    if (pc.realize) Object.assign(state.config.realize, pc.realize);
    if (pc.experiment) Object.assign(state.config.experiment, pc.experiment);
    if (pc.compose) Object.assign(state.config.compose, pc.compose);
    state.updated = new Date().toISOString();
    needsWrite = true;
  }

  // Track anchor changes in timeline
  if (params.anchor !== undefined && params.anchor !== state.anchor) {
    const oldAnchor = state.anchor;
    state.anchor = params.anchor || undefined;
    state.updated = new Date().toISOString();
    needsWrite = true;
    await ResearchTimeline.append({
      type: "focus.changed",
      phase: state.focus?.phase,
      summary: oldAnchor
        ? `Anchor updated: "${params.anchor}" (was: "${oldAnchor}")`
        : `Anchor set: "${params.anchor}"`,
    });
  }

  // Track project_summary updates
  if (params.project_summary !== undefined && params.project_summary !== state.project_summary) {
    state.project_summary = params.project_summary || undefined;
    state.updated = new Date().toISOString();
    needsWrite = true;
  }

  // Single batched write for all accumulated state changes
  if (needsWrite) {
    await ResearchFS.writeYaml(statePath, state);
  }

  return { state, statePath };
}

// ── Action handlers ──────────────────────────────────────────────────────────

async function handleRead(params: any, ctx: StateHandlerContext): Promise<any> {
  return {
    title: ctx.state.project,
    output: await formatState(ctx.state),
    metadata: mdMeta({ state: ctx.state }),
  };
}

async function handleOverview(params: any, ctx: StateHandlerContext): Promise<any> {
  const ov = await buildOverview(ctx.state);
  const recentEvents = await ResearchTimeline.query({ last: 50 });
  return {
    title: "Research Overview",
    output: formatOverview(ov, recentEvents),
    metadata: mdMeta({
      project: ov.project,
      anchor: ov.anchor,
      phase: ov.phase,
      phase_since: ov.phase_since,
      pipeline: ov.pipeline,
      gaps: ov.gaps,
    }),
  };
}

async function handleAdvance(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state, statePath } = ctx;

  if (!params.target_phase) {
    return {
      title: "Missing target_phase",
      output: "advance requires target_phase — the next phase in the main chain.",
      metadata: mdMeta({ error: "missing_target_phase" }),
    };
  }

  // Special case: entering the first phase when no focus is set
  // NOTE: This branch is unreachable after init (which always sets focus to "explore").
  // Kept for safety in case focus is manually cleared — should not trigger in normal flow.
  if (!state.focus) {
    // Enforce that the first phase must be "explore"
    if (params.target_phase !== "explore") {
      return {
        title: "Invalid initial phase",
        output: `The first phase must be "explore". Use advance(target_phase="explore") to begin.`,
        metadata: mdMeta({ error: "invalid_initial_phase", target: params.target_phase }),
      };
    }
    const now = new Date().toISOString();
    const refs = buildFocusRefs(params, undefined);

    // Create phase run first to avoid partial-write
    const phaseRun = await PhaseRunManager.create({
      phase: params.target_phase,
      refs,
      summary: params.summary,
    });

    state.focus = {
      since: now,
      phase: params.target_phase,
      summary: params.summary,
      reason: params.reason,
      blocked_on: null,
      next: params.next,
      active_phase_run: phaseRun.id,
    };
    state.updated = now;
    await ResearchFS.writeYaml(statePath, state);

    await PhaseRunManager.refreshContext(phaseRun.id, {
      trigger: "phase_entry",
      anchor: state.anchor ?? "",
      active_refs: refs,
      next: params.next,
    });

    await ResearchTimeline.append({
      type: "focus.changed",
      phase: params.target_phase,
      to: params.target_phase,
      summary: params.summary ?? `Entered initial phase: ${params.target_phase}`,
      refs: buildRefsArray(refs),
    });

    return {
      title: `Phase: ${params.target_phase}`,
      output: [
        `✅ Entered initial phase: ${params.target_phase}`,
        `Phase run: ${phaseRun.id}`,
        "",
        await formatState(state),
      ].join("\n"),
      metadata: mdMeta({ state }),
    };
  }

  // Not the first phase — validate adjacency
  const currentPhase = state.focus.phase;
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  const targetIdx = PHASE_ORDER.indexOf(params.target_phase);

  if (targetIdx !== currentIdx + 1) {
    const nextPhase = PHASE_ORDER[currentIdx + 1] ?? "(end)";
    const hint =
      params.target_phase === currentPhase
        ? `You are already in "${currentPhase}". To update focus metadata (summary, next, refs), use research_state(action="resume") or research_state(action="redirect", target_phase="${currentPhase}", reason="...").`
        : `Use research_state(action="redirect", target_phase="${params.target_phase}", reason="...") for non-adjacent transitions.`;
    return {
      title: "Invalid advance",
      output: `Cannot advance from "${currentPhase}" to "${params.target_phase}". The next phase is "${nextPhase}".\n\n${hint}`,
      metadata: mdMeta({ error: "invalid_advance", current: currentPhase, target: params.target_phase }),
    };
  }

  // ── Human checkpoints at key transitions (hard enforcement: pending checkpoints block transition) ──
  const currentRunId = state.focus.active_phase_run;

  // Check for unresolved checkpoints before allowing advance
  if (currentRunId) {
    const pendingCheckpoints = await PhaseRunManager.getPendingCheckpoints(currentRunId);
    if (pendingCheckpoints.length > 0) {
      const pendingKinds = pendingCheckpoints.map((cp) => cp.kind).join(", ");
      return {
        title: "Pending checkpoints",
        output: [
          `⚠ Cannot advance from "${currentPhase}" to "${params.target_phase}" — ${pendingCheckpoints.length} unresolved checkpoint(s): ${pendingKinds}`,
          "",
          "Resolve or waive all pending checkpoints before advancing:",
          ...pendingCheckpoints.map((cp) => `  • [${cp.status}] ${cp.kind}: ${cp.question}`),
          "",
          "Use confirmCheckpoint or waiveCheckpoint to resolve, then retry the advance.",
        ].join("\n"),
        metadata: mdMeta({ error: "pending_checkpoints", pending: pendingKinds }),
      };
    }
  }

  // Add transition-specific checkpoints to the CURRENT run.
  // After adding, return immediately — the human must confirm/waive before the next advance call.
  // This ensures checkpoints are never dead (added then immediately promoted).
  let addedCheckpoints = false;

  // Load current run to check for already-resolved checkpoints (prevents re-adding after waive/confirm)
  const currentRun = currentRunId ? await PhaseRunManager.read(currentRunId) : undefined;
  const existingKinds = new Set((currentRun?.human_checkpoints ?? []).map((cp) => cp.kind));

  const transitionKey = `${currentPhase}_${params.target_phase}` as PhaseTransitionKey;
  const injections = CHECKPOINT_INJECTIONS.get(transitionKey);

  if (!injections && currentRunId) {
    log.warn("StateEngine", `No checkpoint injections defined for transition ${currentPhase} → ${params.target_phase}`);
  }

  if (injections && currentRunId) {
    for (const injection of injections) {
      if (!VALID_CHECKPOINT_KINDS.has(injection.kind)) {
        log.warn("StateEngine", `Unknown checkpoint kind "${injection.kind}" in injection table for ${transitionKey}`);
        continue;
      }
      if (!existingKinds.has(injection.kind)) {
        await PhaseRunManager.addCheckpoint(currentRunId, {
          kind: injection.kind,
          question: injection.question,
          ...(injection.resource_commitment ? { resource_commitment: injection.resource_commitment } : {}),
        });
        addedCheckpoints = true;
      }
    }
  }

  // If we added checkpoints, stop here — the human must resolve them before retrying advance.
  // The next advance call will find the pending checkpoints and enter the "resolve first" branch above,
  // then fall through to this point with no new checkpoints to add, and proceed to the actual transition.
  if (addedCheckpoints) {
    return {
      title: "Checkpoints added — resolve before advancing",
      output: [
        `Transition checkpoints added for ${currentPhase} → ${params.target_phase}.`,
        "Resolve or waive all pending checkpoints, then call advance again.",
      ].join("\n"),
      metadata: mdMeta({ status: "checkpoints_added", from: currentPhase, to: params.target_phase }),
    };
  }

  // Mark the previous phase run as promoted before transitioning
  if (currentRunId) {
    await PhaseRunManager.promote(currentRunId, params.target_phase, params.reason);
  }

  const now = new Date().toISOString();
  const refs = buildFocusRefs(params, state.focus);

  // Create phase run for new phase
  const phaseRun = await PhaseRunManager.create({
    phase: params.target_phase,
    refs: refs,
    summary: params.summary,
  });

  // Prepare state update
  state.focus = {
    since: now,
    phase: params.target_phase,
    summary: params.summary,
    reason: params.reason,
    blocked_on: null,
    next: params.next,
    active_phase_run: phaseRun.id,
  };
  state.updated = now;

  // Critical: write state.yaml FIRST — if this fails, rollback the created PhaseRun
  try {
    await ResearchFS.writeYaml(ResearchFS.resolve("state.yaml"), state);
  } catch (writeErr) {
    log.error("StateEngine", `State write failed after creating phase run ${phaseRun.id}, rolling back: ${writeErr}`);
    // Clean up the orphaned new phase run
    try {
      const { unlink } = await import("fs/promises");
      await unlink(ResearchFS.resolve("phase_runs", `${phaseRun.id}.yaml`));
    } catch {
      // Best effort cleanup
    }
    // Revert the old phase run status
    if (currentRunId) {
      try {
        const run = await PhaseRunManager.read(currentRunId);
        if (run) {
          const rolledBack = { ...run, status: "active" as const, updated: new Date().toISOString() };
          await ResearchFS.writeYaml(PhaseRunManager.resolve(currentRunId), rolledBack);
        }
      } catch (rollbackErr) {
        log.error("StateEngine", `Rollback of run ${currentRunId} also failed: ${rollbackErr}`);
      }
    }
    throw writeErr;
  }

  // Side effects: timeline, snapshot, journal — failures are non-fatal
  // (state.yaml has been written, so these are best-effort additions)
  try {
    await PhaseRunManager.refreshContext(phaseRun.id, {
      trigger: "phase_entry",
      anchor: state.anchor ?? "",
      active_refs: refs,
      next: params.next,
    });

    // DESIGN §5: Validate context refresh on phase entry
    const ctxValidation = await PhaseRunManager.validateContextRefresh(phaseRun.id);
    if (!ctxValidation.valid) {
      log.warn("StateEngine", `Context refresh validation warnings: ${ctxValidation.errors.join("; ")}`);
    }

    await ResearchTimeline.append({
      type: "focus.changed",
      phase: params.target_phase,
      from: currentPhase,
      to: params.target_phase,
      summary: params.summary ?? `Advanced: ${currentPhase} → ${params.target_phase}`,
      refs: buildRefsArray(refs),
    });

    await SnapshotManager.create({
      trigger: "phase.promoted",
      phase: currentPhase,
      next_phase: params.target_phase,
      summary: params.summary ?? `Advanced: ${currentPhase} → ${params.target_phase}`,
      refs: await buildSnapshotRefs(state),
      copyRefs: true,
    });

    await ResearchJournal.appendAgentNote({
      kind: "decision_rationale",
      refs: [phaseRun.id, params.target_phase].filter(Boolean),
      summary: `Phase promoted: ${currentPhase} → ${params.target_phase}`,
      note: params.summary
        ? `Advance summary: ${params.summary}${params.next ? "\nNext: " + params.next : ""}`
        : `Phase advanced from ${currentPhase} to ${params.target_phase}.`,
    });
  } catch (err) {
    log.error("StateEngine", `Non-fatal side effect error during advance: ${err}`);
  }

  return {
    title: `Phase: ${params.target_phase}`,
    output: [
      `✅ Advanced: ${currentPhase} → ${params.target_phase}`,
      `Phase run: ${phaseRun.id}`,
      "",
      await formatState(state),
    ].join("\n"),
    metadata: mdMeta({ state }),
  };
}

async function handleRedirect(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state, statePath } = ctx;

  if (!params.target_phase) {
    return {
      title: "Missing target_phase",
      output: "redirect requires target_phase.",
      metadata: mdMeta({ error: "missing_target_phase" }),
    };
  }

  if (!params.reason) {
    return {
      title: "Missing reason",
      output: "redirect requires reason — explain why this non-adjacent transition is needed.",
      metadata: mdMeta({ error: "missing_reason" }),
    };
  }

  const currentPhase = state.focus?.phase ?? "(none)";
  const currentRunId = state.focus?.active_phase_run;

  // Check for existing pending checkpoints before allowing redirect
  if (currentRunId) {
    const pendingCheckpoints = await PhaseRunManager.getPendingCheckpoints(currentRunId);
    if (pendingCheckpoints.length > 0) {
      const pendingKinds = pendingCheckpoints.map((cp) => cp.kind).join(", ");
      return {
        title: "Pending checkpoints",
        output: [
          `⚠ Cannot redirect from "${currentPhase}" to "${params.target_phase}" — ${pendingCheckpoints.length} unresolved checkpoint(s): ${pendingKinds}`,
          "",
          "Resolve or waive all pending checkpoints before redirecting.",
        ].join("\n"),
        metadata: mdMeta({ error: "pending_checkpoints", pending: pendingKinds }),
      };
    }
  }

  // Add pivot confirmation checkpoint — return immediately so human can confirm before actual pivot
  // Check for RESOLVED (confirmed/waived) pivot_confirmation to prevent re-adding after resolution
  // and to ensure the checkpoint was actually resolved before allowing the redirect
  if (currentRunId) {
    const currentRun = await PhaseRunManager.read(currentRunId);
    const existingResolvedPivot = currentRun?.human_checkpoints?.filter(
      (cp) => cp.kind === "pivot_confirmation" && (cp.status === "confirmed" || cp.status === "waived"),
    );
    if (!existingResolvedPivot || existingResolvedPivot.length === 0) {
      // Either no checkpoint or still pending — add one if missing
      const existingPivotCp = currentRun?.human_checkpoints?.filter((cp) => cp.kind === "pivot_confirmation");
      if (!existingPivotCp || existingPivotCp.length === 0) {
        await PhaseRunManager.addCheckpoint(currentRunId, {
          kind: "pivot_confirmation",
          question: `Confirm redirect from ${currentPhase} to ${params.target_phase}. Reason: ${params.reason}`,
        });
      }
      return {
        title: "Pivot checkpoint required",
        output: [
          `Pivot confirmation checkpoint required for ${currentPhase} → ${params.target_phase}.`,
          existingPivotCp && existingPivotCp.length > 0
            ? "Resolve the pending pivot checkpoint (confirm or waive), then call redirect again."
            : "Pivot checkpoint added. Confirm or waive the checkpoint, then call redirect again.",
        ].join("\n"),
        metadata: mdMeta({ status: "pivot_checkpoint_required", from: currentPhase, to: params.target_phase }),
      };
    }
    // Pivot checkpoint was resolved — proceed with redirect
  }

  // Mark the current run as pivoted
  if (currentRunId) {
    await PhaseRunManager.pivot(currentRunId, params.target_phase, {
      from: currentPhase,
      to: params.target_phase,
      category: "scope_shift",
      evidence_refs: [],
      rationale: params.reason,
      alternatives_considered: [],
    });
  }

  const now = new Date().toISOString();
  const refs = buildFocusRefs(params, state.focus);

  // Create phase run first to avoid partial-write
  const phaseRun = await PhaseRunManager.create({
    phase: params.target_phase,
    refs: refs,
    summary: params.summary ?? `Redirected: ${currentPhase} → ${params.target_phase}`,
  });

  // ── Inject transition checkpoints for the destination phase ──
  // Same pattern as handleAdvance: look up CHECKPOINT_INJECTIONS for the
  // (from, to) pair and add any required checkpoints to the new phase run.
  const transitionKey = `${currentPhase}_${params.target_phase}` as PhaseTransitionKey;
  const injections = CHECKPOINT_INJECTIONS.get(transitionKey);
  let addedCheckpoints = false;

  // Load new phase run to check for already-resolved checkpoints (prevents re-adding)
  const newRun = await PhaseRunManager.read(phaseRun.id);
  const existingKinds = new Set((newRun?.human_checkpoints ?? []).map((cp) => cp.kind));

  if (injections) {
    for (const injection of injections) {
      if (!VALID_CHECKPOINT_KINDS.has(injection.kind)) {
        log.warn("StateEngine", `Unknown checkpoint kind "${injection.kind}" in injection table for ${transitionKey}`);
        continue;
      }
      if (!existingKinds.has(injection.kind)) {
        await PhaseRunManager.addCheckpoint(phaseRun.id, {
          kind: injection.kind,
          question: injection.question,
          ...(injection.resource_commitment ? { resource_commitment: injection.resource_commitment } : {}),
        });
        addedCheckpoints = true;
      }
    }
  }

  // Prepare state update (write LAST — after all side-effects succeed)
  state.focus = {
    since: now,
    phase: params.target_phase,
    summary: params.summary,
    reason: params.reason,
    blocked_on: null,
    next: params.next,
    active_phase_run: phaseRun.id,
  };
  state.updated = now;

  // Side effects: timeline, snapshot, journal — failures are non-fatal
  try {
    await PhaseRunManager.refreshContext(phaseRun.id, {
      trigger: "redirect",
      anchor: state.anchor ?? "",
      active_refs: refs,
      next: params.next,
    });

    await ResearchTimeline.append({
      type: "focus.changed",
      phase: params.target_phase,
      from: currentPhase,
      to: params.target_phase,
      summary: params.reason,
      refs: buildRefsArray(refs),
    });

    await SnapshotManager.create({
      trigger: "phase.redirected",
      phase: currentPhase,
      next_phase: params.target_phase,
      summary: params.reason,
      refs: await buildSnapshotRefs(state),
      copyRefs: true,
    });

    await ResearchJournal.appendAgentNote({
      kind: "decision_rationale",
      refs: [phaseRun.id, params.target_phase].filter(Boolean),
      summary: `Phase redirected: ${currentPhase} → ${params.target_phase}`,
      note: `Reason: ${params.reason}${params.summary ? `\nSummary: ${params.summary}` : ""}`,
    });
  } catch (err) {
    log.error("StateEngine", `Non-fatal side effect error during redirect: ${err}`);
  }

  // Critical: write state.yaml — if this fails, rollback
  try {
    await ResearchFS.writeYaml(statePath, state);
  } catch (writeErr) {
    // Rollback: revert old phase run status + delete orphaned new phase run
    log.error("StateEngine", `State write failed after pivoting run ${currentRunId}, rolling back: ${writeErr}`);
    if (currentRunId) {
      try {
        const run = await PhaseRunManager.read(currentRunId);
        if (run) {
          const rolledBack = { ...run, status: "active" as const, updated: new Date().toISOString() };
          await ResearchFS.writeYaml(PhaseRunManager.resolve(currentRunId), rolledBack);
        }
      } catch (rollbackErr) {
        log.error("StateEngine", `Rollback of run ${currentRunId} also failed: ${rollbackErr}`);
      }
    }
    try {
      const { unlink } = await import("fs/promises");
      await unlink(ResearchFS.resolve("phase_runs", `${phaseRun.id}.yaml`));
    } catch {
      // Best effort cleanup
    }
    throw writeErr;
  }

  // If transition checkpoints were added, inform the caller — they must be resolved
  // before meaningful work can proceed in the new phase. The redirect itself is
  // committed (state.yaml written, old run pivoted, new run created), but the
  // pending checkpoints will block subsequent advance/redirect calls.
  if (addedCheckpoints) {
    return {
      title: "Transition checkpoints added — resolve before proceeding",
      output: [
        `✅ Redirected: ${currentPhase} → ${params.target_phase}`,
        `Reason: ${params.reason}`,
        `Phase run: ${phaseRun.id}`,
        "",
        `Transition checkpoints added for ${currentPhase} → ${params.target_phase}.`,
        "Resolve or waive all pending checkpoints before advancing or redirecting further.",
        "",
        await formatState(state),
      ].join("\n"),
      metadata: mdMeta({ status: "checkpoints_added", from: currentPhase, to: params.target_phase, state }),
    };
  }

  return {
    title: `Phase: ${params.target_phase}`,
    output: [
      `✅ Redirected: ${currentPhase} → ${params.target_phase}`,
      `Reason: ${params.reason}`,
      `Phase run: ${phaseRun.id}`,
      "",
      await formatState(state),
    ].join("\n"),
    metadata: mdMeta({ state }),
  };
}

async function handleBlock(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state, statePath } = ctx;

  if (!params.blocked_on) {
    return {
      title: "Missing blocked_on",
      output: "block requires blocked_on — describe what the research is waiting on.",
      metadata: mdMeta({ error: "missing_blocked_on" }),
    };
  }

  if (!state.focus) {
    return {
      title: "No focus set",
      output: [
        "Cannot block — no focus/phase is set.",
        "",
        "Set the initial phase first:",
        `  research_state(action="advance", target_phase="${PHASE_ORDER[0]}")`,
      ].join("\n"),
      metadata: mdMeta({ error: "no_focus" }),
    };
  }

  const now = new Date().toISOString();
  state.focus.blocked_on = params.blocked_on;
  if (params.summary) state.focus.summary = params.summary;
  if (params.next) state.focus.next = params.next;
  state.updated = now;

  // Transition active PhaseRun to "blocked" status and inner_loop state
  if (state.focus.active_phase_run) {
    const now = new Date().toISOString();
    const currentRun = await PhaseRunManager.read(state.focus.active_phase_run);
    const previousInnerLoopState = currentRun?.inner_loop?.state;
    await PhaseRunManager.update(state.focus.active_phase_run, {
      status: "blocked",
      // Deep-merge in PhaseRunManager.update preserves other inner_loop fields
      // Save pre_block_state for resume restoration
      inner_loop: {
        state: "blocked",
        pre_block_state: previousInnerLoopState,
        updated: now,
      } as any,
    });
  }

  await ResearchTimeline.append({
    type: "focus.changed",
    phase: state.focus.phase,
    summary: `Blocked: ${params.blocked_on}`,
    refs: buildRefsArray(await resolveFocusRefs(state)),
  });

  // Write state.yaml LAST — only after all side-effects succeed
  await ResearchFS.writeYaml(statePath, state);

  return {
    title: `Blocked: ${state.focus.phase}`,
    output: [
      `⚠ Phase "${state.focus.phase}" is now blocked`,
      `Blocked on: ${params.blocked_on}`,
      "",
      await formatState(state),
    ].join("\n"),
    metadata: mdMeta({ state }),
  };
}

async function handleResume(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state, statePath } = ctx;

  if (!state.focus) {
    return {
      title: "No focus set",
      output: [
        "Cannot resume — no focus/phase is set.",
        "",
        "Set the initial phase first:",
        `  research_state(action="advance", target_phase="${PHASE_ORDER[0]}")`,
      ].join("\n"),
      metadata: mdMeta({ error: "no_focus" }),
    };
  }

  const now = new Date().toISOString();
  state.focus.blocked_on = null;
  if (params.summary) state.focus.summary = params.summary;
  if (params.next) state.focus.next = params.next;
  state.updated = now;

  // Transition active PhaseRun back to "active" status and restore inner_loop state
  if (state.focus.active_phase_run) {
    const runId = state.focus.active_phase_run;
    const currentRun = await PhaseRunManager.read(runId);
    const previousState = currentRun?.inner_loop?.pre_block_state ?? "attempt";
    await PhaseRunManager.update(runId, {
      status: "active",
      inner_loop: {
        state: previousState,
        updated: new Date().toISOString(),
      } as any,
    });
  }

  await ResearchTimeline.append({
    type: "focus.changed",
    phase: state.focus.phase,
    summary: params.summary ?? `Resumed: ${state.focus.phase}`,
    refs: buildRefsArray(await resolveFocusRefs(state)),
  });

  // Write state.yaml LAST — only after all side-effects succeed
  await ResearchFS.writeYaml(statePath, state);

  return {
    title: `Resumed: ${state.focus.phase}`,
    output: [`✅ Phase "${state.focus.phase}" resumed`, "", await formatState(state)].join("\n"),
    metadata: mdMeta({ state }),
  };
}

async function handleBrief(_params: any, ctx: StateHandlerContext): Promise<any> {
  const { state } = ctx;
  const events = await ResearchTimeline.query({ last: 20 });
  const brief = await formatBrief(state, events);

  // Update AGENTS.md at project root (survives context compaction)
  const projectRoot = scopeDir();
  const agentsMdPath = path.join(projectRoot, "AGENTS.md");
  await withLock(agentsMdMutex, async () => {
    try {
      const existingContent = await Bun.file(agentsMdPath).text();
      const updated = updateAgentsMdDynamic(existingContent, state, events);
      if (updated) {
        await ResearchFS.writeMd(agentsMdPath, updated);
      } else {
        // Markers not found — regenerate full file
        await ResearchFS.writeMd(agentsMdPath, generateAgentsMd(state));
      }
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        log.warn("Brief", `Error reading AGENTS.md: ${e.message}`);
      }
      // File doesn't exist or unreadable — generate it
      await ResearchFS.writeMd(agentsMdPath, generateAgentsMd(state));
    }
  });

  return {
    title: "Handoff brief generated",
    output: ["✅ AGENTS.md updated with current research state (auto-loaded on next session)", "", brief].join("\n"),
    metadata: mdMeta({ path: "AGENTS.md", state }),
  };
}

async function handleConfirmCheckpoint(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state } = ctx;

  if (!params.checkpoint_kind) {
    return {
      title: "Missing checkpoint_kind",
      output: "confirm_checkpoint requires checkpoint_kind — specify which checkpoint to confirm.",
      metadata: mdMeta({ error: "missing_checkpoint_kind" }),
    };
  }
  if (!params.decision) {
    return {
      title: "Missing decision",
      output: "confirm_checkpoint requires decision — provide the human's decision.",
      metadata: mdMeta({ error: "missing_decision" }),
    };
  }

  const runId = state.focus?.active_phase_run;
  if (!runId) {
    return {
      title: "No active phase run",
      output: "Cannot confirm checkpoint — no active phase run in focus.",
      metadata: mdMeta({ error: "no_active_phase_run" }),
    };
  }

  const updated = await PhaseRunManager.confirmCheckpoint(
    runId,
    params.checkpoint_kind,
    params.decision,
    params.rationale,
    params.resource_commitment,
  );
  if (!updated) {
    return {
      title: "Checkpoint not found",
      output: `No pending checkpoint "${params.checkpoint_kind}" found in phase run ${runId}.`,
      metadata: mdMeta({ error: "checkpoint_not_found", checkpoint_kind: params.checkpoint_kind }),
    };
  }

  return {
    title: `Checkpoint confirmed: ${params.checkpoint_kind}`,
    output: [
      `✅ Checkpoint "${params.checkpoint_kind}" confirmed`,
      `Decision: ${params.decision}`,
      ...(params.rationale ? [`Rationale: ${params.rationale}`] : []),
      "",
      await formatState(ctx.state),
    ].join("\n"),
    metadata: mdMeta({ state: ctx.state, phase_run: updated }),
  };
}

async function handleWaiveCheckpoint(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state } = ctx;

  if (!params.checkpoint_kind) {
    return {
      title: "Missing checkpoint_kind",
      output: "waive_checkpoint requires checkpoint_kind — specify which checkpoint to waive.",
      metadata: mdMeta({ error: "missing_checkpoint_kind" }),
    };
  }
  if (!params.reason) {
    return {
      title: "Missing reason",
      output: "waive_checkpoint requires reason — explain why the checkpoint is being waived.",
      metadata: mdMeta({ error: "missing_reason" }),
    };
  }

  const runId = state.focus?.active_phase_run;
  if (!runId) {
    return {
      title: "No active phase run",
      output: "Cannot waive checkpoint — no active phase run in focus.",
      metadata: mdMeta({ error: "no_active_phase_run" }),
    };
  }

  const updated = await PhaseRunManager.waiveCheckpoint(runId, params.checkpoint_kind, params.reason);
  if (!updated) {
    return {
      title: "Checkpoint not found",
      output: `No pending checkpoint "${params.checkpoint_kind}" found in phase run ${runId}.`,
      metadata: mdMeta({ error: "checkpoint_not_found", checkpoint_kind: params.checkpoint_kind }),
    };
  }

  return {
    title: `Checkpoint waived: ${params.checkpoint_kind}`,
    output: [
      `⚠️ Checkpoint "${params.checkpoint_kind}" waived`,
      `Reason: ${params.reason}`,
      "",
      await formatState(ctx.state),
    ].join("\n"),
    metadata: mdMeta({ state: ctx.state, phase_run: updated }),
  };
}

async function handleInnerLoopTransition(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state } = ctx;

  if (!params.target_state) {
    return {
      title: "Missing target_state",
      output: "inner_loop_transition requires target_state — specify the target inner loop state.",
      metadata: mdMeta({ error: "missing_target_state" }),
    };
  }

  const runId = state.focus?.active_phase_run;
  if (!runId) {
    return {
      title: "No active phase run",
      output: "Cannot transition inner loop — no active phase run in focus.",
      metadata: mdMeta({ error: "no_active_phase_run" }),
    };
  }

  const updated = await PhaseRunManager.transitionInnerLoopState(runId, params.target_state);
  if (!updated) {
    return {
      title: "Transition failed",
      output: `Failed to transition inner loop state for phase run ${runId}.`,
      metadata: mdMeta({ error: "transition_failed" }),
    };
  }

  return {
    title: `Inner loop: ${params.target_state}`,
    output: [`✅ Inner loop transitioned to "${params.target_state}"`, "", await formatState(ctx.state)].join("\n"),
    metadata: mdMeta({ state: ctx.state, phase_run: updated }),
  };
}

async function handleRecordDecision(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state } = ctx;

  if (!params.inner_decision) {
    return {
      title: "Missing inner_decision",
      output: "record_decision requires inner_decision — specify the decision (iterate, promote, pivot, or abort).",
      metadata: mdMeta({ error: "missing_inner_decision" }),
    };
  }

  const runId = state.focus?.active_phase_run;
  if (!runId) {
    return {
      title: "No active phase run",
      output: "Cannot record decision — no active phase run in focus.",
      metadata: mdMeta({ error: "no_active_phase_run" }),
    };
  }

  const result = await PhaseRunManager.recordDecision(runId, params.inner_decision, params.summary);
  if (!result.run) {
    return {
      title: "Record decision failed",
      output: `Failed to record decision for phase run ${runId}.`,
      metadata: mdMeta({ error: "record_decision_failed" }),
    };
  }

  // Surface budget warning if iterate was rejected
  const budgetWarning = result.budgetWarning;

  return {
    title: `Decision: ${params.inner_decision}`,
    output: [
      budgetWarning
        ? `⚠️ Iterate rejected: ${budgetWarning}`
        : `✅ Inner loop decision recorded: "${params.inner_decision}"`,
      ...(params.summary ? [`Summary: ${params.summary}`] : []),
      "",
      await formatState(ctx.state),
    ].join("\n"),
    metadata: mdMeta({ state: ctx.state, phase_run: result.run }),
  };
}

async function handleAbort(params: any, ctx: StateHandlerContext): Promise<any> {
  const { state, statePath } = ctx;

  if (!state.focus) {
    return {
      title: "No focus set",
      output: "Cannot abort — no focus/phase is set.",
      metadata: mdMeta({ error: "no_focus" }),
    };
  }

  const runId = state.focus.active_phase_run;
  if (!runId) {
    return {
      title: "No active phase run",
      output: "Cannot abort — no active phase run in focus.",
      metadata: mdMeta({ error: "no_active_phase_run" }),
    };
  }

  const abortedRun = await PhaseRunManager.abort(runId, params.reason ?? "Aborted by user");
  if (!abortedRun) {
    return {
      title: "Abort failed",
      output: `Failed to abort phase run ${runId}.`,
      metadata: mdMeta({ error: "abort_failed" }),
    };
  }

  const now = new Date().toISOString();
  state.focus = undefined;
  state.updated = now;
  await ResearchFS.writeYaml(statePath, state);

  await ResearchTimeline.append({
    type: "focus.changed",
    phase: abortedRun.phase,
    summary: `Aborted: ${params.reason ?? "Aborted by user"}`,
    refs: buildRefsArray(abortedRun.refs as FocusRefs | undefined),
  });

  return {
    title: "Phase aborted",
    output: [
      `⚠️ Phase "${abortedRun.phase}" aborted`,
      `Reason: ${params.reason ?? "Aborted by user"}`,
      `Phase run: ${runId}`,
      "",
      "Focus cleared. Use advance or redirect to start a new phase.",
    ].join("\n"),
    metadata: mdMeta({ state }),
  };
}

// ── Overview formatting (uses buildOverview from overview.ts) ─────────────────

function formatOverview(ov: OverviewResult, recentEvents: TimelineEvent[]): string {
  const lines: string[] = ["=== Research Overview ===", ""];

  // Identity
  lines.push(`Project: ${ov.project}`);
  lines.push(`Anchor: ${ov.anchor ?? "(not set)"}`);
  if (ov.phase) {
    lines.push(`Phase: ${ov.phase} (since ${ov.phase_since!.slice(0, 10)})`);
  } else {
    lines.push("Phase: (not set)");
  }
  lines.push("");

  // Pipeline
  lines.push("Pipeline");
  const p = ov.pipeline;
  lines.push(`  Idea:   ${p.idea ? `${p.idea.id} [${p.idea.status}] ${p.idea.title}` : "(none)"}`);
  lines.push(`  Plan:   ${p.plan ? `${p.plan.id} [${p.plan.status}] ${p.plan.title}` : "(none)"}`);

  const expParts = Object.entries(p.experiments.by_status)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  lines.push(`  Exps:   ${p.experiments.total} total${expParts ? ` (${expParts})` : ""}`);

  const claimParts = Object.entries(p.claims.by_status)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  lines.push(`  Claims: ${p.claims.total} total${claimParts ? ` (${claimParts})` : ""}`);

  const exhParts = Object.entries(p.exhibits.by_status)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  lines.push(`  Exhibits: ${p.exhibits.total} total${exhParts ? ` (${exhParts})` : ""}`);

  lines.push(
    `  Paper:  ${p.paper ? `${p.paper.id} [${p.paper.status}] ${p.paper.sections_bound}/${p.paper.sections_total} sections bound to claims` : "(none)"}`,
  );
  lines.push(
    `  Submission: ${p.submission ? `${p.submission.id} [${p.submission.status}]${p.submission.venue ? ` → ${p.submission.venue}` : ""}` : "(none)"}`,
  );
  lines.push("");

  // Gaps
  lines.push("Gaps");
  const g = ov.gaps;
  const fmtList = (items: Array<{ id: string; md_path: string }>) =>
    items.length ? items.map((i) => `${i.id}  →  ${i.md_path}`).join("\n                         ") : "(none)";
  lines.push(`  Orphan experiments:    ${fmtList(g.orphan_experiments)}`);
  lines.push(`  Unanalyzed experiments: ${fmtList(g.unanalyzed_experiments)}`);
  lines.push(`  Weak claims:           ${fmtList(g.weak_claims)}`);
  lines.push(
    `  Unbound paper sections: ${g.unbound_paper_sections.length ? g.unbound_paper_sections.join(", ") : "(none)"}`,
  );
  if (g.stalled.length) {
    const stalledStr = g.stalled
      .map((s) => `${s.id} [${s.status}] since ${s.since.slice(0, 10)}  →  ${s.md_path}`)
      .join("\n                         ");
    lines.push(`  Stalled:               ${stalledStr}`);
  } else {
    lines.push("  Stalled:               (none)");
  }
  lines.push("");

  // Recent Activity
  lines.push("Recent Activity");
  if (recentEvents.length === 0) {
    lines.push("  No timeline events yet.");
  } else {
    for (const ev of recentEvents.slice(-10)) {
      const ts = ev.ts.slice(0, 16).replace("T", " ");
      const idStr = ev.id ? ` (${ev.id})` : "";
      const summary = ev.summary ?? ev.type;
      lines.push(`  ${ts}  ${ev.type}${idStr}: ${summary}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

// ── Tool definition ────────────────────────────────────────────────────────────

export const researchState = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum([
        "read",
        "advance",
        "redirect",
        "block",
        "resume",
        "brief",
        "overview",
        "confirm_checkpoint",
        "waive_checkpoint",
        "inner_loop_transition",
        "record_decision",
        "abort",
      ])
      .describe(
        "Action: read state, advance to next phase, redirect to any phase, block current phase, resume from block, generate handoff brief, get global overview, confirm/waive a checkpoint, transition inner loop state, record an inner loop decision, or abort the current phase run and clear focus",
      ),
    anchor: z
      .string()
      .optional()
      .describe(
        "Update the research direction anchor. This is the user's evolving research intent — set it when the direction becomes clear, update it when it legitimately changes. Every update is recorded in the timeline.",
      ),
    project_summary: z
      .string()
      .max(60)
      .optional()
      .describe(
        "Set a concise one-line project summary (≤60 chars). Generated by the agent during init from the anchor text. Used by the monitor board as the project title.",
      ),
    target_phase: ProjectPhase.optional().describe(
      "Target phase for advance/redirect. Must be the next adjacent phase for advance; any valid phase for redirect.",
    ),
    summary: z.string().optional().describe("One-line summary of what the research is focused on in this phase."),
    reason: z.string().optional().describe("Why this transition is happening. Required for redirect."),
    refs_idea: z.string().optional().describe("Idea currently in focus, e.g. 'idea_014'."),
    refs_plan: z.string().optional().describe("Plan currently in focus, e.g. 'plan_003'."),
    refs_experiments: z
      .array(z.string())
      .optional()
      .describe("Experiments currently in focus, e.g. ['exp_010', 'exp_011']."),
    refs_claims: z.array(z.string()).optional().describe("Claims currently in focus, e.g. ['claim_001', 'claim_002']."),
    refs_exhibits: z.array(z.string()).optional().describe("Exhibits currently in focus, e.g. ['exh_005', 'exh_006']."),
    refs_paper: z.string().optional().describe("Paper currently in focus, e.g. 'paper_001'."),
    refs_submission: z.string().optional().describe("Submission currently in focus, e.g. 'sub_001'."),
    blocked_on: z.string().optional().describe("What the research is blocked on. Required for block action."),
    next: z.string().optional().describe("Next action to take, e.g. 'Design ablation matrix'."),
    checkpoint_kind: z
      .string()
      .optional()
      .describe(
        "Kind of checkpoint to confirm or waive (e.g. 'taste_selection', 'resource_commitment'). Required for confirm_checkpoint and waive_checkpoint actions.",
      ),
    decision: z
      .string()
      .optional()
      .describe("Human's decision for confirm_checkpoint action. Required for confirm_checkpoint."),
    rationale: z
      .string()
      .optional()
      .describe("Rationale for the checkpoint confirmation. Optional for confirm_checkpoint."),
    resource_commitment: ResourceCommitment.optional().describe(
      "Updated resource commitment for confirm_checkpoint action (resource_commitment kind only). Allows adjusting GPU type, count, hours etc. from the default recommendation.",
    ),
    target_state: z
      .enum(["attempt", "evaluate", "decide", "promoted", "pivoted", "aborted"])
      .optional()
      .describe("Target inner loop state for inner_loop_transition action."),
    inner_decision: z
      .enum(["iterate", "promote", "pivot", "abort"])
      .optional()
      .describe("Inner loop decision for record_decision action."),
    participation_mode: ParticipationMode.optional().describe(
      "Update participation mode: collaborative, guided, or autonomous.",
    ),
    venue: z.string().optional().describe("Update target venue. Pass empty string to clear."),
    phase_config: z
      .object({
        stalled_days: z.number().optional(),
        exploration: ExplorationConfig.partial().optional(),
        ground: GroundConfig.partial().optional(),
        design: DesignConfig.partial().optional(),
        realize: RealizeConfig.partial().optional(),
        experiment: ExperimentConfig.partial().optional(),
        compose: ComposeConfig.partial().optional(),
      })
      .optional()
      .describe(
        "Update phase-specific config. Deep merged into existing config. Example: {design: {max_review_rounds: 8}}",
      ),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(stateMutex, async () => {
        const prepared = await loadAndPrepareState(params);
        if (!prepared) return notInitialized();
        const ctx: StateHandlerContext = prepared;

        switch (params.action) {
          case "read":
            return handleRead(params, ctx);
          case "overview":
            return handleOverview(params, ctx);
          case "advance":
            return handleAdvance(params, ctx);
          case "redirect":
            return handleRedirect(params, ctx);
          case "block":
            return handleBlock(params, ctx);
          case "resume":
            return handleResume(params, ctx);
          case "brief":
            return handleBrief(params, ctx);
          case "confirm_checkpoint":
            return handleConfirmCheckpoint(params, ctx);
          case "waive_checkpoint":
            return handleWaiveCheckpoint(params, ctx);
          case "inner_loop_transition":
            return handleInnerLoopTransition(params, ctx);
          case "record_decision":
            return handleRecordDecision(params, ctx);
          case "abort":
            return handleAbort(params, ctx);
          default:
            return {
              title: "Invalid action",
              output: `Unknown action: ${params.action}`,
              metadata: mdMeta({ error: "invalid_action" }),
            };
        }
      });
    });
  },
});
