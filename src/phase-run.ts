import { generateAndSaveBrief } from "./checkpoint-context";
import { ResearchFS } from "./fs";
import { getMutex, withLock } from "./lock";
import { log } from "./log";
import type { PhaseRun, ResourceCommitment } from "./schema";
import { SnapshotManager } from "./snapshot";

export interface RecordDecisionResult {
  run: PhaseRun | undefined;
  budgetWarning?: string;
}

const phaseRunMutex = getMutex("phase_run");
const stateMutex = getMutex("state");

const VALID_PHASE_RUN_TRANSITIONS: Record<string, string[]> = {
  active: ["promoted", "pivoted", "aborted", "blocked"],
  blocked: ["active", "aborted"],
  promoted: [], // terminal
  pivoted: [], // terminal
  aborted: [], // terminal
};

type ProjectPhaseValue = PhaseRun["phase"];

export namespace PhaseRunManager {
  const DIR = "phase_runs";

  export function resolve(id: string): string {
    return ResearchFS.resolve(DIR, `${id}.yaml`);
  }

  export async function create(params: {
    phase: ProjectPhaseValue;
    refs?: PhaseRun["refs"];
    summary?: string;
  }): Promise<PhaseRun> {
    return withLock(phaseRunMutex, async () => {
      // Generate a unique, sortable ID using timestamp + random suffix
      const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const now = new Date().toISOString();
      const run: PhaseRun = {
        id,
        phase: params.phase,
        status: "active",
        created: now,
        updated: now,
        inner_loop: {
          state: "attempt",
          created: now,
          updated: now,
          round: 1,
          attempts: 0,
          stagnation_rounds: 0,
          escalation_count: 0,
          budget: {
            max_attempts: 6,
            max_stagnation: 2,
            max_escalations: 2,
          },
        },
        refs: params.refs,
        human_checkpoints: [],
        artifacts: {},
        summary: params.summary,
      };

      await ResearchFS.writeYaml(resolve(id), run);
      return run;
    });
  }

  export async function read(id: string): Promise<PhaseRun | undefined> {
    return ResearchFS.readYaml<PhaseRun>(resolve(id));
  }

  /**
   * Update a PhaseRun. Nested objects `refs` and `inner_loop` are deep-merged
   * (individual fields preserved) so partial patches are safe. All other
   * fields use shallow merge as usual.
   */
  export async function update(id: string, patch: Partial<PhaseRun>): Promise<PhaseRun | undefined> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(id);
      if (!run) return undefined;

      // Validate status transition if patch changes status
      if (patch.status !== undefined && patch.status !== run.status) {
        const validTargets = VALID_PHASE_RUN_TRANSITIONS[run.status];
        if (!validTargets?.includes(patch.status)) {
          throw new Error(
            `Invalid PhaseRun status transition: ${run.status} → ${patch.status}. Valid: ${validTargets?.join(", ") ?? "(terminal)"}`,
          );
        }

        // Enforce inner_loop.state consistency for terminal statuses
        const TERMINAL_STATUSES = ["promoted", "pivoted", "aborted"] as const;
        if (TERMINAL_STATUSES.includes(patch.status as (typeof TERMINAL_STATUSES)[number])) {
          if (!patch.inner_loop || patch.inner_loop.state !== patch.status) {
            log.warn(
              "PhaseRunManager",
              `Auto-setting inner_loop.state="${patch.status}" to match terminal status (run ${id})`,
            );
            patch = {
              ...patch,
              inner_loop: {
                ...(patch.inner_loop ?? run.inner_loop),
                state: patch.status as PhaseRun["inner_loop"]["state"],
                updated: new Date().toISOString(),
              },
            };
          }
        }
      }

      // Deep-merge nested objects to prevent accidental field loss
      const merged = { ...run, ...patch, updated: new Date().toISOString() };

      // Always preserve nested objects — shallow-merge if patch provides, keep run's if not
      if (run.refs) {
        merged.refs = patch.refs ? { ...run.refs, ...patch.refs } : { ...run.refs };
      }
      if (run.inner_loop) {
        merged.inner_loop = patch.inner_loop ? { ...run.inner_loop, ...patch.inner_loop } : { ...run.inner_loop };
      }

      await ResearchFS.writeYaml(resolve(id), merged);
      return merged;
    });
  }

  export async function list(): Promise<PhaseRun[]> {
    const dir = ResearchFS.resolve(DIR);
    const files = await ResearchFS.listYaml(dir);
    const runs: PhaseRun[] = [];
    for (const file of files) {
      const run = await ResearchFS.readYaml<PhaseRun>(ResearchFS.resolve(DIR, file));
      if (run) runs.push(run);
    }
    return runs.sort((a, b) => a.created.localeCompare(b.created));
  }

  export async function getActive(projectPhase: string): Promise<PhaseRun | undefined> {
    const runs = await list();
    return runs.find((r) => r.phase === projectPhase && r.status === "active");
  }

  export async function promote(id: string, nextPhase: string, reason?: string): Promise<PhaseRun | undefined> {
    return update(id, {
      status: "promoted",
      inner_loop: {
        state: "promoted" as const,
        updated: new Date().toISOString(),
      } as PhaseRun["inner_loop"],
      summary: reason ? `Promoted to ${nextPhase}: ${reason}` : `Promoted to ${nextPhase}`,
    });
  }

  export async function pivot(id: string, to: string, reason: PhaseRun["pivot"]): Promise<PhaseRun | undefined> {
    return update(id, {
      status: "pivoted",
      inner_loop: {
        state: "pivoted" as const,
        last_decision: "pivot" as const,
        updated: new Date().toISOString(),
      } as PhaseRun["inner_loop"],
      pivot: reason,
    });
  }

  export async function abort(id: string, reason: string): Promise<PhaseRun | undefined> {
    return update(id, {
      status: "aborted",
      inner_loop: {
        state: "aborted",
        last_decision: "abort",
        updated: new Date().toISOString(),
      } as PhaseRun["inner_loop"],
      summary: reason,
    });
  }

  /** Add a human checkpoint to a PhaseRun.
   *  Enforces uniqueness: only one pending checkpoint of a given kind may exist. */
  export async function addCheckpoint(
    runId: string,
    checkpoint: {
      kind:
        | "taste_selection"
        | "resource_commitment"
        | "reasonableness_check"
        | "pivot_confirmation"
        | "paper_ambition"
        | "submission_readiness";
      question: string;
      resource_commitment?: ResourceCommitment;
    },
  ): Promise<PhaseRun | undefined> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return undefined;

      // Prevent duplicate pending checkpoints of the same kind
      const existingPending = run.human_checkpoints.filter(
        (cp) => cp.kind === checkpoint.kind && cp.status === "pending",
      );
      if (existingPending.length > 0) {
        throw new Error(`Cannot add checkpoint "${checkpoint.kind}": a pending checkpoint of this kind already exists`);
      }

      const now = new Date().toISOString();
      const entry = {
        kind: checkpoint.kind,
        status: "pending" as const,
        question: checkpoint.question,
        created: now,
        updated: now,
        ...(checkpoint.resource_commitment ? { resource_commitment: checkpoint.resource_commitment } : {}),
      };

      const updated: PhaseRun = {
        ...run,
        human_checkpoints: [...run.human_checkpoints, entry],
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);

      // Auto-generate checkpoint brief for human context
      try {
        const brief = await generateAndSaveBrief({
          phaseRunId: runId,
          checkpointKind: checkpoint.kind,
          checkpointQuestion: checkpoint.question,
        });

        // Update checkpoint with brief reference
        if (brief) {
          const withBrief: PhaseRun = {
            ...updated,
            human_checkpoints: updated.human_checkpoints.map((cp) =>
              cp.kind === checkpoint.kind && cp.status === "pending" && !cp.brief_ref
                ? { ...cp, brief_ref: brief.filePath, brief_generated_at: brief.generatedAt }
                : cp,
            ),
            updated: new Date().toISOString(),
          };
          await ResearchFS.writeYaml(resolve(runId), withBrief);
          return withBrief;
        }
        return updated;
      } catch (err) {
        log.error("CheckpointBrief", `Failed to generate brief for checkpoint: ${checkpoint.kind}`, err);
        return updated; // brief_ref remains absent — caller can detect missing brief
      }
    });
  }

  /** Confirm a pending checkpoint by kind. */
  export async function confirmCheckpoint(
    runId: string,
    checkpointKind: string,
    decision: string,
    rationale?: string,
    resourceCommitment?: ResourceCommitment,
  ): Promise<PhaseRun | undefined> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return undefined;

      let found = false;
      const now = new Date().toISOString();
      const updatedCheckpoints = run.human_checkpoints.map((cp) => {
        if (cp.kind === checkpointKind && cp.status === "pending") {
          found = true;
          return {
            ...cp,
            status: "confirmed" as const,
            decision,
            rationale,
            updated: now,
            // Allow updating resource_commitment on confirm (agent may adjust from default)
            ...(resourceCommitment ? { resource_commitment: resourceCommitment } : {}),
          };
        }
        return cp;
      });

      if (!found) return undefined;

      const updated = {
        ...run,
        human_checkpoints: updatedCheckpoints,
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);

      // DESIGN §3.4: Create snapshot on human checkpoint confirmation
      try {
        await SnapshotManager.onCheckpointConfirmed({
          runId,
          checkpointKind: checkpointKind,
          phase: updated.phase,
        });
      } catch (err) {
        log.error("Checkpoint", `Snapshot creation failed for ${checkpointKind}`, err);
      }

      return updated;
    });
  }

  /** Waive a pending checkpoint by kind. */
  export async function waiveCheckpoint(
    runId: string,
    checkpointKind: string,
    reason: string,
  ): Promise<PhaseRun | undefined> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return undefined;

      let found = false;
      const now = new Date().toISOString();
      const updatedCheckpoints = run.human_checkpoints.map((cp) => {
        if (cp.kind === checkpointKind && cp.status === "pending") {
          found = true;
          return { ...cp, status: "waived" as const, waived_reason: reason, updated: now };
        }
        return cp;
      });

      if (!found) return undefined;

      const updated = {
        ...run,
        human_checkpoints: updatedCheckpoints,
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);
      return updated;
    });
  }

  export async function getPendingCheckpoints(runId: string): Promise<PhaseRun["human_checkpoints"]> {
    const run = await read(runId);
    if (!run) return [];
    return run.human_checkpoints.filter((cp) => cp.status === "pending");
  }

  /** Check if all human checkpoints for a run are resolved (confirmed or waived). */
  export async function allCheckpointsResolved(runId: string): Promise<boolean> {
    const pending = await getPendingCheckpoints(runId);
    return pending.length === 0;
  }

  // ── Inner Loop Engine ──────────────────────────────────────────────────────

  /** Valid transitions for the inner loop state machine. */
  const VALID_INNER_TRANSITIONS: Record<string, Set<string>> = {
    attempt: new Set(["evaluate", "blocked"]),
    evaluate: new Set(["decide", "blocked"]),
    decide: new Set(["attempt", "promoted", "pivoted", "aborted", "blocked"]),
    blocked: new Set(["attempt", "evaluate", "decide"]),
    promoted: new Set([]),
    pivoted: new Set([]),
    aborted: new Set([]),
  };

  /** Get the set of valid target states from a given inner loop state. */
  export function getValidTransitions(current: string): Set<string> | undefined {
    return VALID_INNER_TRANSITIONS[current];
  }

  /** Transition the inner loop state machine (attempt → evaluate → decide). */
  export async function transitionInnerLoopState(
    runId: string,
    targetState: "attempt" | "evaluate" | "decide" | "promoted" | "pivoted" | "aborted" | "blocked",
  ): Promise<PhaseRun | undefined> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return undefined;

      const current = run.inner_loop?.state ?? "attempt";
      const allowed = VALID_INNER_TRANSITIONS[current];
      if (!allowed?.has(targetState)) {
        throw new Error(
          `Invalid inner loop transition: ${current} → ${targetState}. Valid: ${allowed ? [...allowed].join(", ") : "(terminal)"}`,
        );
      }

      const now = new Date().toISOString();
      const updated: PhaseRun = {
        ...run,
        inner_loop: {
          ...run.inner_loop,
          state: targetState,
          updated: now,
        },
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);
      return updated;
    });
  }

  // NOTE: Not called from tools; updateActivePhaseRun handles attempt tracking
  /** Record an attempt within the current inner loop round. Increments attempts counter and optionally updates progress metric. */
  export async function recordAttempt(
    runId: string,
    progressMetric?: { name: string; previous?: number; current?: number },
  ): Promise<PhaseRun | undefined> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return undefined;

      const now = new Date().toISOString();
      const newAttempts = (run.inner_loop?.attempts ?? 0) + 1;

      const updated: PhaseRun = {
        ...run,
        inner_loop: {
          ...run.inner_loop,
          attempts: newAttempts,
          progress_metric: progressMetric ?? run.inner_loop?.progress_metric,
          updated: now,
        },
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);

      // Check budget after incrementing attempts
      const budgetResult = await enforceBudget(runId, updated);
      if (budgetResult.forcedAction !== "none") {
        log.warn(
          "BudgetEnforcement",
          `Budget enforced for ${runId} after attempt ${newAttempts}: ${budgetResult.reason}`,
        );
      }

      return updated;
    });
  }

  // NOTE: Not called from tools; stagnation tracking is handled via progress metrics in the decide step
  /** Check stagnation by comparing progress metric. Returns updated run with stagnation_rounds incremented if no progress. */
  export async function checkStagnation(runId: string): Promise<{ run: PhaseRun | undefined; isStagnant: boolean }> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return { run: undefined, isStagnant: false };

      const metric = run.inner_loop?.progress_metric;
      let isStagnant = false;

      // If we have a numeric progress metric, compare current vs previous
      // Stagnation depends on direction: for "max" metrics, no increase = stagnant;
      // for "min" metrics (e.g., loss), no decrease = stagnant
      if (metric && typeof metric.previous === "number" && typeof metric.current === "number") {
        const direction = metric.direction ?? "max";
        isStagnant = direction === "max" ? metric.current <= metric.previous : metric.current >= metric.previous;
      }

      const now = new Date().toISOString();
      const newStagnationRounds = isStagnant ? (run.inner_loop?.stagnation_rounds ?? 0) + 1 : 0; // Reset to 0 if progress detected
      const newEscalationCount = isStagnant
        ? (run.inner_loop?.escalation_count ?? 0) + 1
        : (run.inner_loop?.escalation_count ?? 0);

      const updated: PhaseRun = {
        ...run,
        inner_loop: {
          ...run.inner_loop,
          stagnation_rounds: newStagnationRounds,
          escalation_count: newEscalationCount,
          updated: now,
        },
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);
      return { run: updated, isStagnant };
    });
  }

  /** Enforce budget limits. Returns enforcement result indicating what action is forced. */
  export async function enforceBudget(
    runId: string,
    currentRun?: PhaseRun,
  ): Promise<{
    run: PhaseRun | undefined;
    forcedAction: "none" | "must_decide" | "must_escalate";
    reason: string;
  }> {
    const run = currentRun ?? (await read(runId));
    if (!run) return { run: undefined, forcedAction: "none", reason: "Phase run not found" };

    const budget = run.inner_loop?.budget;
    if (!budget) return { run, forcedAction: "none", reason: "No budget defined" };

    const attempts = run.inner_loop?.attempts ?? 0;
    const stagnation = run.inner_loop?.stagnation_rounds ?? 0;
    const escalations = run.inner_loop?.escalation_count ?? 0;

    // Rule 1: attempts > max_attempts → must decide (pivot or abort)
    if (attempts > budget.max_attempts) {
      return {
        run,
        forcedAction: "must_decide",
        reason: `Attempt budget exhausted: ${attempts}/${budget.max_attempts}. Must pivot or abort.`,
      };
    }

    // Rule 2: stagnation > max_stagnation → must escalate to human or reframe
    if (stagnation > budget.max_stagnation) {
      return {
        run,
        forcedAction: "must_escalate",
        reason: `Stagnation budget exhausted: ${stagnation}/${budget.max_stagnation}. Must reframe, pivot, or escalate to human.`,
      };
    }

    // Rule 3: escalation_count > max_escalations → must decide (further escalation blocked)
    if (escalations > budget.max_escalations) {
      return {
        run,
        forcedAction: "must_decide",
        reason: `Escalation budget exhausted: ${escalations}/${budget.max_escalations}. Must pivot or abort.`,
      };
    }

    return { run, forcedAction: "none", reason: "Within budget" };
  }

  /** Record a decision from the inner loop decide step. Advances round if iterating, or transitions inner_loop to promoted/pivoted/aborted. */
  export async function recordDecision(
    runId: string,
    decision: "iterate" | "promote" | "pivot" | "abort",
    summary?: string,
  ): Promise<RecordDecisionResult> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return { run: undefined };

      const now = new Date().toISOString();
      const newInnerLoop = { ...run.inner_loop! };

      newInnerLoop.last_decision = decision;
      newInnerLoop.updated = now;

      if (decision === "iterate") {
        // Budget enforcement: reject iterate if budget is exhausted
        const budgetResult = await enforceBudget(runId, run);
        if (budgetResult.forcedAction !== "none") {
          log.warn(
            "BudgetEnforcement",
            `Budget exhausted (${budgetResult.reason}), iterate rejected. Must decide: ${budgetResult.forcedAction}`,
          );
          const warningRun: PhaseRun = {
            ...run,
            inner_loop: newInnerLoop,
          };
          return {
            run: warningRun,
            budgetWarning: `Budget exhausted: ${budgetResult.reason}. Must ${budgetResult.forcedAction} instead of iterate.`,
          };
        }

        newInnerLoop.round = (newInnerLoop.round ?? 1) + 1;
        newInnerLoop.state = "attempt";
        newInnerLoop.attempts = 0; // Reset attempts for new round
        newInnerLoop.stagnation_rounds = 0; // Reset stagnation
        // Do NOT increment escalation_count on normal iterate — it tracks stagnation-triggered escalations only
        // escalation_count is incremented by checkStagnation when stagnation_rounds > 0
        newInnerLoop.round_started_at = now;
      } else if (decision === "promote") {
        newInnerLoop.state = "promoted";
      } else if (decision === "pivot") {
        newInnerLoop.state = "pivoted";
      } else if (decision === "abort") {
        newInnerLoop.state = "aborted";
      }

      const terminalDecision =
        decision === "promote"
          ? "promoted"
          : decision === "pivot"
            ? "pivoted"
            : decision === "abort"
              ? "aborted"
              : undefined;

      const updated: PhaseRun = {
        ...run,
        inner_loop: newInnerLoop,
        ...(terminalDecision ? { status: terminalDecision as PhaseRun["status"] } : {}),
        summary: summary ?? run.summary,
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);
      return { run: updated };
    });
  }

  export async function refreshContext(
    runId: string,
    params: {
      trigger: string;
      anchor: string;
      active_refs: PhaseRun["refs"];
      used_wiki_refs?: string[];
      checked_skill_rules?: string[];
      drift_check?: { status: "pass" | "warning" | "block"; note?: string };
      next?: string;
    },
  ): Promise<PhaseRun | undefined> {
    return withLock(phaseRunMutex, async () => {
      const run = await read(runId);
      if (!run) return undefined;

      const now = new Date().toISOString();
      const updated: PhaseRun = {
        ...run,
        context_refresh: {
          refreshed_at: now,
          trigger: params.trigger,
          loaded: {
            anchor: params.anchor,
            ...(params.active_refs ?? {}),
          },
          used_wiki_refs: params.used_wiki_refs ?? [],
          checked_skill_rules: params.checked_skill_rules ?? [],
          drift_check: params.drift_check,
          next: params.next,
        },
        updated: now,
      };

      await ResearchFS.writeYaml(resolve(runId), updated);
      return updated;
    });
  }

  export async function validateContextRefresh(runId: string): Promise<{ valid: boolean; errors: string[] }> {
    const run = await read(runId);
    const errors: string[] = [];
    if (!run) {
      errors.push("Phase run not found");
      return { valid: false, errors };
    }

    const refresh = run.context_refresh;
    if (!refresh) {
      errors.push("No context refresh recorded");
      return { valid: false, errors };
    }

    // refreshed_at must be within current round
    const roundStart = run.inner_loop?.round_started_at ?? run.inner_loop?.created ?? run.created;
    if (refresh.refreshed_at < roundStart) {
      errors.push("Context refresh is stale (from a previous round)");
    }

    // active_refs must cover core objects
    const loaded = refresh.loaded ?? {};
    const refs = loaded as Record<string, unknown>;
    const hasCore = refs.idea || refs.plan || (Array.isArray(refs.experiments) && refs.experiments.length > 0);
    if (!hasCore) {
      errors.push("Active refs do not cover core objects");
    }

    // used_wiki_refs must exist (or waiver reason)
    const wikiRefs = refresh.used_wiki_refs ?? [];
    if (wikiRefs.length === 0) {
      errors.push("No wiki refs used (waiver required if unavailable)");
    }

    // checked_skill_rules must cover relevant rules
    const checkedRules = refresh.checked_skill_rules ?? [];
    if (checkedRules.length === 0) {
      errors.push("No skill rules checked");
    }

    // drift_check must not be "block"
    if (refresh.drift_check?.status === "block") {
      errors.push("Drift check status is 'block'");
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Shared helper: update the inner_loop of the currently active phase run,
 * but only if it belongs to the specified phase. Non-fatal — errors are logged but swallowed.
 *
 * When setting `state`, validates the transition against the inner loop state machine.
 * If the transition is invalid, logs a warning but applies it anyway (the caller knows best).
 *
 * Supports `incrementAttempts` to atomically bump attempts by 1 inside the helper
 * (where the current run is already loaded), avoiding the need to pass a computed value.
 */
export async function updateActivePhaseRun(
  phase: string,
  update: {
    incrementAttempts?: boolean;
    attempts?: number;
    state?: PhaseRun["inner_loop"]["state"];
    summary?: string;
  },
  runId?: string,
): Promise<void> {
  try {
    let targetRunId = runId;
    if (!targetRunId) {
      const state = await withLock(stateMutex, async () => {
        return await ResearchFS.readYaml<{
          focus?: { active_phase_run?: string; phase?: string };
        }>(ResearchFS.resolve("state.yaml"));
      });
      targetRunId = state?.focus?.active_phase_run;
      if (!targetRunId || state?.focus?.phase !== phase) {
        if (state?.focus?.phase !== phase) {
          log.warn(
            "PhaseRun",
            `updateActivePhaseRun: phase mismatch (current=${state?.focus?.phase}, expected=${phase}), skipping`,
          );
        }
        return;
      }
    }

    const run = await PhaseRunManager.read(targetRunId);
    if (!run) return;

    // Validate state transition if changing state
    if (update.state !== undefined) {
      const current = run.inner_loop?.state ?? "attempt";
      const allowed = PhaseRunManager.getValidTransitions(current);
      if (allowed && !allowed.has(update.state)) {
        const msg = `updateActivePhaseRun: invalid transition ${current} → ${update.state} (phase: ${phase})`;
        log.warn("InnerLoop", msg);
        // Throw on critical transitions to prevent silent inner loop corruption
        if (update.state === "decide" || update.state === "evaluate") {
          throw new Error(msg);
        }
      }
    }

    const attempts = update.incrementAttempts ? (run.inner_loop.attempts ?? 0) + 1 : update.attempts;

    await PhaseRunManager.update(targetRunId, {
      inner_loop: {
        ...run.inner_loop,
        ...(attempts !== undefined ? { attempts } : {}),
        ...(update.state !== undefined ? { state: update.state } : {}),
        ...(update.summary !== undefined ? { summary: update.summary } : {}),
      },
    });

    // Re-read after update for accurate budget check
    const updatedRun = await PhaseRunManager.read(targetRunId);
    const budgetResult = await PhaseRunManager.enforceBudget(targetRunId, updatedRun);
    if (budgetResult.forcedAction !== "none") {
      log.warn("BudgetEnforcement", `Budget enforced for ${targetRunId}: ${budgetResult.reason}`);
    }
  } catch (err) {
    log.warn("PhaseRun", `updateActivePhaseRun failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
}
