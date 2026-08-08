import type { PluginSurfaceContext } from "@ericsanchezok/synergy-plugin";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import "./index.css";
import ErrorBoundary from "./components/ErrorBoundary";
import Icon from "./components/icons";
import WorkflowBoard from "./components/WorkflowBoard";
import { buildMonitorData, isEmptyMonitor } from "./data";
import type { ApiHumanCheckpoint, ApiResponse, MonitorData, PhaseName, ResearchBrief } from "./types";

interface LoadState {
  status: "loading" | "error" | "ready" | "empty";
  error?: string;
}

interface PendingCheckpoint {
  phase: PhaseName;
  checkpoint: ApiHumanCheckpoint;
}

/** Collect pending human checkpoints across all phases from the monitor payload. */
function findPendingCheckpoints(api: ApiResponse): PendingCheckpoint[] {
  const result: PendingCheckpoint[] = [];
  const phaseMap = api.phaseDetailsMap ?? {};

  if (api.activeRun?.run) {
    for (const cp of api.activeRun.run.human_checkpoints ?? []) {
      if (cp.status === "pending") {
        result.push({ phase: (api.activeRun.run.phase as PhaseName) ?? "explore", checkpoint: cp });
      }
    }
  }

  const phases = Object.keys(phaseMap) as PhaseName[];
  for (const phase of phases) {
    const pd = phaseMap[phase];
    const runs = pd?.all_runs ?? pd?.active_runs ?? [];
    for (const run of runs) {
      for (const cp of run.human_checkpoints ?? []) {
        if (cp.status === "pending") {
          result.push({ phase: (run.phase as PhaseName) ?? phase, checkpoint: cp });
        }
      }
    }
  }

  const seen = new Set<string>();
  const deduped: PendingCheckpoint[] = [];
  for (const item of result) {
    const key = `${item.phase}:${item.checkpoint.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

function Loader({ label }: { label: string }) {
  return (
    <div class="holos-state">
      <div class="holos-state__spinner" />
      <div class="holos-meta" style={{ color: "var(--holos-accent)" }}>
        {label}
      </div>
      <div class="holos-meta">Establishing research data stream…</div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div class="holos-state">
      <div class="holos-state__card">
        <div class="holos-state__error-head">
          <Icon name="alert" size={20} color="var(--holos-danger)" />
          <div>
            <p class="holos-state__error-title">Monitor data stream unavailable</p>
            <p class="holos-state__error-message">{message}</p>
          </div>
        </div>
        <button type="button" class="holos-btn" onClick={onRetry}>
          Retry Connection
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div class="holos-state">
      <div class="holos-state__card">
        <Icon name="spark" size={20} color="var(--holos-accent)" />
        <p class="holos-state__empty-title">No research project in this Scope — run research_init to start.</p>
      </div>
    </div>
  );
}

export default function MonitorPanel(context: PluginSurfaceContext) {
  const [state, setState] = createSignal<LoadState>({ status: "loading" });
  const [data, setData] = createSignal<MonitorData | null>(null);
  const [brief, setBrief] = createSignal<ResearchBrief | null>(null);
  const [pendingCheckpoints, setPendingCheckpoints] = createSignal<PendingCheckpoint[]>([]);
  const [focusPhase, setFocusPhase] = createSignal<PhaseName | null>(null);

  const queryAll = async (): Promise<ApiResponse | null> => {
    try {
      const raw = await context.operations.query("monitor.all");
      if (raw && typeof raw === "object" && "ok" in raw && "data" in raw) {
        const envelope = raw as { ok: boolean; data?: ApiResponse };
        return envelope.ok ? (envelope.data ?? null) : null;
      }
      return raw as ApiResponse | null;
    } catch {
      return null;
    }
  };

  const queryBrief = async (): Promise<ResearchBrief | null> => {
    try {
      const raw = await context.operations.query("monitor.brief");
      if (raw && typeof raw === "object" && "ok" in raw && "data" in raw) {
        const envelope = raw as { ok: boolean; data?: ResearchBrief };
        return envelope.ok ? (envelope.data ?? null) : null;
      }
      return raw as ResearchBrief | null;
    } catch {
      return null;
    }
  };

  const refresh = async () => {
    const api = await queryAll();
    if (!api) {
      setState({ status: "error", error: "monitor.all returned no payload" });
      return;
    }
    if (isEmptyMonitor(api)) {
      setState({ status: "empty" });
      setData(null);
      setBrief(null);
      setPendingCheckpoints([]);
      return;
    }
    setData(buildMonitorData(api));
    setPendingCheckpoints(findPendingCheckpoints(api));
    setState({ status: "ready" });
    const b = await queryBrief();
    setBrief(b);
  };

  onMount(() => {
    void refresh();
    const dispose = context.events.subscribe("research.changed", () => {
      void refresh();
    });
    onCleanup(() => dispose());
  });

  return (
    <ErrorBoundary>
      <Show when={state().status === "loading"}>
        <Loader label="INITIALIZING MONITOR" />
      </Show>
      <Show when={state().status === "error"}>
        <ErrorState message={state().error ?? "Unknown error"} onRetry={() => void refresh()} />
      </Show>
      <Show when={state().status === "empty"}>
        <EmptyState />
      </Show>
      <Show when={state().status === "ready" && data()}>
        {(d) => {
          const monitor = () => d() as MonitorData;
          return (
            <div class="holos-root">
              <Show when={pendingCheckpoints().length > 0}>
                <div class="holos-checkpoint-banner" role="status">
                  <Icon name="flag" size={13} color="var(--holos-warning)" strokeWidth={2.4} />
                  <span class="holos-checkpoint-banner__text">
                    {pendingCheckpoints().length} pending human checkpoint{pendingCheckpoints().length > 1 ? "s" : ""}
                  </span>
                  <div class="holos-checkpoint-banner__items">
                    <For each={pendingCheckpoints()}>
                      {(item) => (
                        <button
                          type="button"
                          class="holos-checkpoint-banner__chip"
                          onClick={() => setFocusPhase(item.phase)}
                        >
                          {item.phase} · {item.checkpoint.kind}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <WorkflowBoard data={monitor()} brief={brief()} />
              <Show when={focusPhase()}>
                {(fp) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close, Escape key provided onKeyDown
                  <div
                    class="holos-focus-scroll"
                    tabIndex={-1}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) setFocusPhase(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setFocusPhase(null);
                    }}
                  >
                    <div class="holos-focus-scroll__card">
                      <div class="holos-focus-scroll__head">
                        <span class="holos-meta">PHASE INSPECTOR</span>
                        <button
                          type="button"
                          class="holos-drawer__close"
                          onClick={() => setFocusPhase(null)}
                          aria-label="Close"
                        >
                          <Icon name="x" size={16} color="var(--text-subtle)" strokeWidth={2.2} />
                        </button>
                      </div>
                      <div class="holos-focus-scroll__body">
                        <Show
                          when={monitor().phases.find((p) => p.name === fp())}
                          fallback={
                            <div class="holos-drawer__empty">
                              <Icon name="alert" size={12} color="var(--text-weaker)" />
                              Phase not found
                            </div>
                          }
                        >
                          {(ph) => (
                            <div class="holos-focus-scroll__phase">
                              <h2 class="holos-drawer__title">{ph().displayName}</h2>
                              <div class="holos-drawer__desc">
                                <p>{ph().description}</p>
                              </div>
                              <Show when={ph().checkpoints.length > 0}>
                                <div class="holos-focus-scroll__checkpoints">
                                  <For each={ph().checkpoints}>
                                    {(chk) => (
                                      <div
                                        class="holos-checkpoint"
                                        style={{ border: "1px solid var(--holos-warning)33" }}
                                      >
                                        <div
                                          class="holos-checkpoint__icon"
                                          style={{
                                            background: "rgba(251,191,36,0.15)",
                                            border: "1px solid rgba(251,191,36,0.33)",
                                          }}
                                        >
                                          <Icon name="flag" size={12} color="var(--holos-warning)" strokeWidth={2.4} />
                                        </div>
                                        <div class="holos-checkpoint__body">
                                          <div class="holos-checkpoint__head">
                                            <span
                                              class="holos-checkpoint__kind"
                                              style={{ color: "var(--holos-warning)" }}
                                            >
                                              {chk.kind}
                                            </span>
                                            <span
                                              class="holos-checkpoint__status"
                                              style={{
                                                background: "var(--surface-base)",
                                                color: "var(--holos-warning)",
                                              }}
                                            >
                                              {chk.status.toUpperCase()}
                                            </span>
                                          </div>
                                          <div class="holos-checkpoint__question">{chk.question ?? ""}</div>
                                        </div>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </Show>
            </div>
          );
        }}
      </Show>
    </ErrorBoundary>
  );
}
