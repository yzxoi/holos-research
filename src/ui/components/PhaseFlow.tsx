import { For, Show } from "solid-js";
import { PHASE_COLORS_HEX, PHASE_DISPLAY_NAMES, PHASE_ORDER } from "../constants";
import type { PhaseInfo, PhaseName, PhaseRunCard } from "../types";
import { shortId } from "../utils";

interface PhaseFlowProps {
  phases: PhaseInfo[];
  phaseRunCards: PhaseRunCard[];
  onSelect?: (phase: PhaseInfo) => void;
}

interface RunStyle {
  bg: string;
  border: string;
  dot: string;
  label: string;
}

const STATUS_STYLES: Record<string, RunStyle> = {
  active: { bg: "rgba(90,166,240,0.12)", border: "rgba(90,166,240,0.5)", dot: "#5aa6f0", label: "active" },
  promoted: { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.3)", dot: "#34d399", label: "promoted" },
  pivoted: { bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.4)", dot: "#fbbf24", label: "pivoted" },
  aborted: { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)", dot: "#f87171", label: "aborted" },
  blocked: { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.5)", dot: "#f87171", label: "blocked" },
};

const DEFAULT_RUN_STYLE: RunStyle = {
  bg: "rgba(52,211,153,0.08)",
  border: "rgba(52,211,153,0.3)",
  dot: "#34d399",
  label: "promoted",
};

interface FlowEdge {
  from: PhaseName;
  fromIdx: number;
  to: PhaseName;
  toIdx: number;
  type: "promote" | "pivot";
  category?: string;
}

/**
 * NOTE: props must be read through the `props` object — Solid component
 * functions run once at mount, so destructuring would freeze the initial
 * values and later prop updates (e.g. phase selection) would never re-render.
 */
export default function PhaseFlow(props: PhaseFlowProps) {
  const runsByPhase = new Map<PhaseName, PhaseRunCard[]>();
  for (const phase of PHASE_ORDER) runsByPhase.set(phase, []);
  for (const card of props.phaseRunCards) {
    const list = runsByPhase.get(card.phase);
    if (list) list.push(card);
  }

  const runIndexByPhase = new Map<string, Map<string, number>>();
  for (const [phase, runs] of runsByPhase) {
    const idxMap = new Map<string, number>();
    runs.forEach((r, i) => {
      idxMap.set(r.id, i);
    });
    runIndexByPhase.set(phase, idxMap);
  }

  const edges: FlowEdge[] = [];
  for (const card of props.phaseRunCards) {
    const fromIdx = runIndexByPhase.get(card.phase)?.get(card.id) ?? 0;
    if (card.status === "promoted") {
      const orderIdx = PHASE_ORDER.indexOf(card.phase);
      const toPhase = PHASE_ORDER[orderIdx + 1];
      if (toPhase) {
        const toRuns = runsByPhase.get(toPhase) ?? [];
        const targetRun = toRuns.find((r) => r.created >= card.updated);
        const toIdx = targetRun ? (runIndexByPhase.get(toPhase)?.get(targetRun.id) ?? -1) : -1;
        edges.push({ from: card.phase, fromIdx, to: toPhase, toIdx, type: "promote" });
      }
    } else if (card.status === "pivoted" && card.pivotTo) {
      const toRuns = runsByPhase.get(card.pivotTo) ?? [];
      const targetRun = toRuns.find((r) => r.created >= card.updated);
      const toIdx = targetRun ? (runIndexByPhase.get(card.pivotTo)?.get(targetRun.id) ?? -1) : -1;
      edges.push({ from: card.phase, fromIdx, to: card.pivotTo, toIdx, type: "pivot", category: card.pivotCategory });
    }
  }

  const totalRuns = props.phaseRunCards.length;
  const pivotEdges = edges.filter((e) => e.type === "pivot");

  return (
    <div class="holos-card holos-flow">
      <div class="holos-flow__line" />
      <div class="holos-card__head">
        <h2 class="holos-section-title">Workflow Topology</h2>
        <span class="holos-meta">
          {totalRuns} runs · {pivotEdges.length} pivots
        </span>
        <div class="holos-flow__legend">
          <span class="holos-flow__legend-item">
            <span class="holos-flow__legend-line" style={{ background: "var(--holos-success)" }} /> promote
          </span>
          <span class="holos-flow__legend-item">
            <span class="holos-flow__legend-dash" style={{ "border-color": "var(--holos-warning)" }} /> pivot
          </span>
          <For each={["active", "promoted", "pivoted"]}>
            {(s) => {
              const st = STATUS_STYLES[s] ?? DEFAULT_RUN_STYLE;
              return (
                <span class="holos-flow__legend-item">
                  <span class="holos-flow__legend-dot" style={{ background: st.dot }} />
                  {st.label}
                </span>
              );
            }}
          </For>
        </div>
      </div>

      <div class="holos-flow__grid">
        <For each={PHASE_ORDER}>
          {(phaseName) => {
            const phaseInfo = props.phases.find((p) => p.name === phaseName);
            const runs = runsByPhase.get(phaseName) ?? [];
            const isActive = phaseInfo?.status === "active";
            const isCompleted = phaseInfo?.status === "completed";
            const color = PHASE_COLORS_HEX[phaseName];
            return (
              <div class="holos-flow__col">
                <button
                  type="button"
                  class="holos-flow__col-head"
                  classList={{ "holos-flow__col-head--active": isActive }}
                  style={{ "border-color": isActive ? `${color}40` : "var(--border-weak-base)" }}
                  onClick={() => phaseInfo && props.onSelect?.(phaseInfo)}
                >
                  <div class="holos-flow__phase-num" style={{ color: isActive ? color : "var(--text-weaker)" }}>
                    {String(PHASE_ORDER.indexOf(phaseName) + 1).padStart(2, "0")}
                  </div>
                  <div class="holos-flow__phase-name">
                    <span
                      class="holos-flow__phase-label"
                      style={{
                        color: isActive
                          ? "var(--text-strong)"
                          : isCompleted
                            ? "var(--holos-success)"
                            : "var(--text-subtle)",
                      }}
                    >
                      {PHASE_DISPLAY_NAMES[phaseName]}
                    </span>
                    <Show when={phaseInfo}>
                      <span
                        class="holos-flow__phase-dot"
                        style={{
                          background:
                            phaseInfo?.status === "active"
                              ? "var(--holos-accent)"
                              : phaseInfo?.status === "completed"
                                ? "var(--holos-success)"
                                : phaseInfo?.status === "blocked"
                                  ? "#f87171"
                                  : "var(--text-weaker)",
                        }}
                      />
                    </Show>
                  </div>
                  <Show when={isActive && phaseInfo?.run?.innerLoop?.summary}>
                    <div class="holos-flow__phase-summary" title={phaseInfo?.run?.innerLoop?.summary}>
                      {(phaseInfo?.run?.innerLoop?.summary ?? "").length > 40
                        ? (phaseInfo?.run?.innerLoop?.summary ?? "").slice(0, 37) + "…"
                        : phaseInfo?.run?.innerLoop?.summary}
                    </div>
                  </Show>
                </button>

                <div class="holos-flow__runs">
                  <For each={runs}>
                    {(run, idx) => {
                      const st = STATUS_STYLES[run.status] ?? DEFAULT_RUN_STYLE;
                      const isRunActive = run.status === "active";
                      const edgeFrom = edges.find((e) => e.from === phaseName && e.fromIdx === idx());
                      const edgeTo = edges.find((e) => e.to === phaseName && e.toIdx === idx());
                      return (
                        <button
                          type="button"
                          class="holos-flow__run"
                          style={{
                            background: st.bg,
                            border: `1px solid ${st.border}`,
                            "min-height": "40px",
                            "animation-delay": `${Math.min(idx() * 0.05, 0.3)}s`,
                          }}
                          onClick={() => phaseInfo && props.onSelect?.(phaseInfo)}
                        >
                          <div class="holos-flow__run-head">
                            <span
                              class="holos-flow__run-dot"
                              style={{
                                background: st.dot,
                                ...(isRunActive ? { animation: "holos-breath 1.6s ease-in-out infinite" } : {}),
                              }}
                            />
                            <span class="holos-flow__run-id">{shortId(run.id)}</span>
                          </div>
                          <div class="holos-flow__run-meta">
                            <span>R{run.round}</span>
                            <Show when={run.attempts > 1}>
                              <span>×{run.attempts}</span>
                            </Show>
                          </div>
                          <Show when={edgeFrom}>
                            <span
                              class="holos-flow__edge-out"
                              style={{
                                color: edgeFrom?.type === "pivot" ? "var(--holos-warning)" : "var(--holos-success)",
                              }}
                            >
                              {edgeFrom?.type === "pivot" ? "↗" : "→"}
                            </span>
                          </Show>
                          <Show when={edgeTo}>
                            <span
                              class="holos-flow__edge-in"
                              style={{
                                background: edgeTo?.type === "pivot" ? "var(--holos-warning)" : "var(--holos-success)",
                              }}
                            />
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                  <Show when={runs.length === 0}>
                    <div class="holos-flow__empty">—</div>
                  </Show>
                </div>

                <Show when={runs.length > 0}>
                  <div class="holos-flow__run-count">
                    {runs.length} run{runs.length > 1 ? "s" : ""}
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>

      <Show when={pivotEdges.length > 0}>
        <div class="holos-flow__pivot-notes">
          <For each={pivotEdges}>
            {(e) => (
              <span class="holos-flow__pivot-note">
                {PHASE_DISPLAY_NAMES[e.from]} ↗ {PHASE_DISPLAY_NAMES[e.to]}
                {e.category ? ` (${e.category.replace(/_/g, " ")})` : ""}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
