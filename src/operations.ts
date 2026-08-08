import type { PluginInvocationContext } from "@ericsanchezok/synergy-plugin";
import { operation } from "@ericsanchezok/synergy-plugin";
import z from "zod";
import { runWithInvocation, type WorkspaceService } from "./ctx";
import { ResearchFS } from "./fs";
import { MonitorBoard } from "./monitor";
import { PhaseRunManager } from "./phase-run";
import { PHASE_ORDER, ProjectPhase } from "./schema";

/**
 * Monitor query operations — the UI-side replacement for the legacy
 * `src/api/monitor.ts` HTTP server. Each operation resolves the active
 * Scope directory from the host-injected workspace service, binds it into
 * the AsyncLocalStorage invocation context (`runWithInvocation`), and
 * returns the same data shapes the original `/api/*` endpoints produced
 * (monitor-board types unchanged).
 */

const monitorBoard = new MonitorBoard();

/** Cast the host workspace service to the plugin's minimal surface. */
function hostWorkspace(context: PluginInvocationContext): WorkspaceService | undefined {
  return context.workspace as WorkspaceService | undefined;
}

/**
 * Bind the host workspace service and directory into the invocation context,
 * then run the aggregation. `fn` observes the bound service through
 * `ctx.workspace()` and the directory through `scopeDir()`.
 */
async function runInScope<T>(context: PluginInvocationContext, fn: () => Promise<T>): Promise<T> {
  const svc = hostWorkspace(context);
  const meta = (await svc?.metadata?.()) as { scopeId?: string; directory?: string } | undefined;
  const dir = meta?.directory;
  if (!dir) throw new Error("workspace.metadata() returned no directory — cannot locate the research project");
  return runWithInvocation(dir, svc, fn);
}

/** Throw a structured error when the project is not initialized. */
async function requireInitialized(): Promise<void> {
  const ok = await ResearchFS.isInitialized();
  if (!ok) {
    throw new Error("No research project found in this Scope — run research_init first.");
  }
}

/**
 * Empty dashboard payload for uninitialized projects. The panel's
 * isEmptyMonitor() treats this as the empty state ("run research_init to
 * start") instead of a data-stream error.
 */
function emptyMonitorPayload() {
  return {
    workflow: null,
    entities: {
      counts: {
        ideas: 0,
        plans: 0,
        experiments: 0,
        claims: 0,
        exhibits: 0,
        papers: 0,
        submissions: 0,
      },
      focus_refs: {},
    },
    entityRecords: [],
    timeline: { events: [] },
    journal: { notes: [] },
    activeRun: null,
    phaseDetailsMap: {},
    phaseRuns: [],
  };
}

function checkpointsForRun(run: { human_checkpoints?: Array<{ status?: string }> }): number {
  return (run.human_checkpoints ?? []).filter((c) => c.status === "pending").length;
}

export const monitorAll = operation({
  id: "monitor.all",
  type: "query",
  expose: ["ui"],
  input: z.object({}),
  output: z.unknown(),
  async handler(_input, context) {
    return runInScope(context, async () => {
      if (!(await ResearchFS.isInitialized())) return emptyMonitorPayload();
      const allPhaseRuns = await PhaseRunManager.list();
      const [workflow, entities, entityRecords, timeline, journal, activeRun] = await Promise.all([
        monitorBoard.cached("workflow", 5_000, () => monitorBoard.getWorkflowStatus()),
        monitorBoard.cached("entities", 5_000, () => monitorBoard.getEntitySummary()),
        monitorBoard.cached("entityRecords", 5_000, () => monitorBoard.getEntityRecords()),
        monitorBoard.cached("timeline", 5_000, () => monitorBoard.getTimelinePreview({ last: 100 })),
        monitorBoard.cached("journal", 5_000, () => monitorBoard.getJournalPreview(20)),
        monitorBoard.cached("activeRun", 5_000, () => monitorBoard.getActivePhaseRun()),
      ]);

      const phaseDetailsMap = Object.fromEntries(
        (
          await Promise.all(
            PHASE_ORDER.map(async (p) => {
              const details = await monitorBoard.getPhaseDetails(p, allPhaseRuns);
              return [p, details] as const;
            }),
          )
        ).map(([p, d]) => [p, d]),
      );

      const phaseRuns = allPhaseRuns.map((r) => ({
        id: r.id,
        phase: r.phase,
        status: r.status,
        created: r.created,
        updated: r.updated,
        pivot: r.pivot
          ? {
              from: r.pivot.from,
              to: r.pivot.to,
              category: r.pivot.category,
              rationale: r.pivot.rationale,
            }
          : undefined,
        inner_loop: r.inner_loop
          ? {
              state: r.inner_loop.state,
              round: r.inner_loop.round,
              attempts: r.inner_loop.attempts,
            }
          : undefined,
      }));

      return {
        workflow,
        entities,
        entityRecords,
        timeline,
        journal,
        activeRun: (({ state: _s, ...rest }) => rest)(activeRun),
        phaseDetailsMap,
        phaseRuns,
      };
    });
  },
});

export const monitorWorkflow = operation({
  id: "monitor.workflow",
  type: "query",
  expose: ["ui"],
  input: z.object({}),
  output: z.unknown(),
  async handler(_input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      return monitorBoard.cached("workflow", 5_000, () => monitorBoard.getWorkflowStatus());
    });
  },
});

export const monitorPhase = operation({
  id: "monitor.phase",
  type: "query",
  expose: ["ui"],
  input: z.object({ phase: ProjectPhase }),
  output: z.unknown(),
  async handler(input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      const allPhaseRuns = await PhaseRunManager.list();
      return monitorBoard.getPhaseDetails(input.phase, allPhaseRuns);
    });
  },
});

export const monitorEntities = operation({
  id: "monitor.entities",
  type: "query",
  expose: ["ui"],
  input: z.object({}),
  output: z.unknown(),
  async handler(_input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      return monitorBoard.cached("entities", 5_000, () => monitorBoard.getEntitySummary());
    });
  },
});

export const monitorTimeline = operation({
  id: "monitor.timeline",
  type: "query",
  expose: ["ui"],
  input: z.object({
    limit: z.number().optional(),
    type: z.string().optional(),
    since: z.string().optional(),
    refs: z.string().optional(),
  }),
  output: z.unknown(),
  async handler(input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      const events = await monitorBoard.getTimelinePreview({
        last: input.limit ?? 20,
        type: input.type,
        since: input.since,
        refs: input.refs
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      return events;
    });
  },
});

export const monitorJournal = operation({
  id: "monitor.journal",
  type: "query",
  expose: ["ui"],
  input: z.object({ limit: z.number().optional() }),
  output: z.unknown(),
  async handler(input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      return monitorBoard.getJournalPreview(input.limit ?? 20);
    });
  },
});

export const monitorActiveRun = operation({
  id: "monitor.activeRun",
  type: "query",
  expose: ["ui"],
  input: z.object({}),
  output: z.unknown(),
  async handler(_input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      const activeRun = await monitorBoard.getActivePhaseRun();
      return (({ state: _s, ...rest }) => rest)(activeRun);
    });
  },
});

export const monitorBrief = operation({
  id: "monitor.brief",
  type: "query",
  expose: ["ui"],
  input: z.object({}),
  output: z.unknown(),
  async handler(_input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      const dir = ResearchFS.resolve(".");
      return monitorBoard.generateBrief(dir);
    });
  },
});

/** Pending human checkpoint count across all phase runs (used by the panel banner). */
export const monitorCheckpointSummary = operation({
  id: "monitor.checkpointSummary",
  type: "query",
  expose: ["ui"],
  input: z.object({}),
  output: z.unknown(),
  async handler(_input, context) {
    return runInScope(context, async () => {
      await requireInitialized();
      const runs = await PhaseRunManager.list();
      return {
        pending: runs
          .map((run) => ({ run, pending: checkpointsForRun(run as never) }))
          .filter((x) => x.pending > 0)
          .map((x) => ({ runId: x.run.id, phase: x.run.phase, pending: x.pending })),
      };
    });
  },
});
