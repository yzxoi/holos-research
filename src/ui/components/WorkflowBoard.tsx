import { createSignal, For, Show } from "solid-js";
import type { EntityKind, MonitorData, PhaseInfo, ResearchBrief as ResearchBriefType } from "../types";
import { clockTime } from "../utils";
import EntitySummary from "./EntitySummary";
import Icon from "./icons";
import JournalFeed from "./JournalFeed";
import PhaseDetailDrawer from "./PhaseDetailDrawer";
import PhaseFlow from "./PhaseFlow";
import ProgressRing from "./ProgressRing";
import ResearchBrief from "./ResearchBrief";
import TimelineFeed from "./TimelineFeed";

interface WorkflowBoardProps {
  data: MonitorData;
  brief: ResearchBriefType | null;
}

export default function WorkflowBoard({ data, brief }: WorkflowBoardProps) {
  const [selectedPhase, setSelectedPhase] = createSignal<PhaseInfo | null>(null);
  const [entityFilter, setEntityFilter] = createSignal<EntityKind | null>(null);

  const activePhase = () => data.phases.find((p) => p.status === "active");
  const completedCount = () => data.phases.filter((p) => p.status === "completed").length;
  const totalPhases = data.phases.length;
  const progressPct = () => (totalPhases > 0 ? completedCount() / totalPhases : 0);

  const phaseStatus = () => new Map(data.phases.map((p) => [p.name, p.status]));
  const visibleEdges = () =>
    data.pivotEdges.filter((e) => {
      const s = phaseStatus().get(e.from);
      return s === "completed" || s === "active";
    });

  const ringColor =
    progressPct() >= 0.8
      ? "var(--holos-success)"
      : progressPct() >= 0.4
        ? "var(--holos-accent)"
        : "var(--holos-warning)";

  const entityTotal = () => data.entitySummaries.reduce((sum, s) => sum + s.total, 0);

  return (
    <div class="holos-panel">
      {/* ═══ HEADER ════════════════════════════════════════ */}
      <header class="holos-header">
        <div class="holos-header__glow" />
        <div class="holos-header__main">
          <div class="holos-header__brand">
            <div class="holos-header__logo">
              <Icon name="activity" size={14} color="var(--holos-accent)" strokeWidth={2.4} />
            </div>
            <span class="holos-header__title">
              <Icon name="spark" size={9} color="var(--holos-accent)" strokeWidth={2.4} />
              RESEARCH MONITOR
              <span class="holos-header__version">v2.1</span>
            </span>
            <span class="holos-header__live">
              <span class="holos-header__live-dot" />
              LIVE
            </span>
          </div>
          <h1 class="holos-header__project" title={data.anchor}>
            {data.projectSummary ?? data.projectName}
          </h1>
          <Show when={data.anchor}>
            <p class="holos-header__anchor">{data.anchor}</p>
          </Show>
        </div>

        <div class="holos-header__stats">
          <div class="holos-header__completion">
            <ProgressRing
              value={completedCount()}
              max={totalPhases}
              size={62}
              strokeWidth={4}
              color={ringColor}
              label={`${completedCount()}/${totalPhases}`}
              sublabel="PHASE"
            />
            <div class="holos-header__completion-text">
              <span class="holos-meta">COMPLETION</span>
              <span class="holos-header__completion-pct" style={{ color: ringColor }}>
                {Math.round(progressPct() * 100)}
                <span style={{ "font-size": "11px", color: "var(--text-weaker)" }}>%</span>
              </span>
              <span class="holos-meta">workflow</span>
            </div>
          </div>
          <Show when={activePhase()}>
            <div class="holos-header__current">
              <span class="holos-meta">CURRENT</span>
              <span class="holos-header__current-chip">
                <span class="holos-header__live-dot" />
                {activePhase()?.displayName.toUpperCase()}
              </span>
              <span class="holos-meta">
                phase {data.phases.indexOf(activePhase() as PhaseInfo) + 1} of {totalPhases}
              </span>
            </div>
          </Show>
          <div class="holos-header__sync">
            <span class="holos-meta">LAST SYNC</span>
            <span class="holos-header__sync-time">
              <Icon name="clock" size={10} color="var(--text-weaker)" strokeWidth={2} />
              {clockTime(data.lastUpdated)}
            </span>
            <span class="holos-meta">event-driven</span>
          </div>
        </div>
      </header>

      {/* ═══ RESEARCH BRIEF ════════════════════════════════ */}
      <ResearchBrief brief={brief} />

      {/* ═══ PHASE FLOW ══════════════════════════════════ */}
      <section class="holos-section">
        <PhaseFlow phases={data.phases} phaseRunCards={data.phaseRunCards} onSelect={setSelectedPhase} />
      </section>

      {/* ═══ PIVOT ROUTES ════════════════════════════════ */}
      <Show when={visibleEdges().length > 0}>
        <section class="holos-section">
          <div class="holos-section-head">
            <h2 class="holos-section-title">
              <Icon name="undo" size={11} color="var(--text-subtle)" strokeWidth={2.2} />
              Available Pivot Routes
            </h2>
            <span class="holos-meta">{visibleEdges().length} reachable</span>
          </div>
          <div class="holos-pivot-routes">
            <For each={visibleEdges()}>
              {(e) => (
                <div
                  class="holos-pivot-route"
                  style={{ background: "rgba(251, 191, 36, 0.05)", border: "1px solid rgba(251, 191, 36, 0.18)" }}
                >
                  <Icon name="undo" size={11} color="var(--holos-warning)" strokeWidth={2.2} />
                  <span style={{ color: "var(--text-subtle)" }}>{e.from}</span>
                  <Icon name="chevronRight" size={11} color="var(--text-weaker)" />
                  <span style={{ color: "var(--text-subtle)" }}>{e.to}</span>
                  <span class="holos-pivot-route__trigger">{e.trigger}</span>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* ═══ ENTITY SUMMARY ══════════════════════════════ */}
      <section class="holos-section">
        <div class="holos-section-head">
          <div class="holos-section-head__left">
            <h2 class="holos-section-title">
              <Icon name="workflow" size={11} color="var(--text-subtle)" strokeWidth={2.2} />
              Research Entities
            </h2>
            <span class="holos-meta">{entityTotal()} total · click to filter</span>
            <Show when={entityFilter()}>
              <button type="button" class="holos-clear-filter" onClick={() => setEntityFilter(null)}>
                ✕ clear filter
              </button>
            </Show>
          </div>
        </div>
        <EntitySummary
          summaries={data.entitySummaries}
          activeFilter={entityFilter()}
          onFilter={setEntityFilter}
          timeline={data.timeline}
        />
      </section>

      {/* ═══ FEEDS ═══════════════════════════════════════ */}
      <section class="holos-feeds">
        <div class="holos-card holos-card--feed">
          <div class="holos-card__head">
            <h2 class="holos-section-title">
              <Icon name="history" size={11} color="var(--text-subtle)" strokeWidth={2.2} />
              Timeline
            </h2>
            <span class="holos-meta">{data.timeline.length} events</span>
          </div>
          <TimelineFeed events={data.timeline} />
        </div>
        <div class="holos-card holos-card--feed">
          <div class="holos-card__head">
            <h2 class="holos-section-title">
              <Icon name="book" size={11} color="var(--text-subtle)" strokeWidth={2.2} />
              Journal
            </h2>
            <span class="holos-meta">{data.journal.length} entries</span>
          </div>
          <JournalFeed entries={data.journal} />
        </div>
      </section>

      {/* ═══ DRAWER ══════════════════════════════════════ */}
      <PhaseDetailDrawer phase={selectedPhase()} data={data} onClose={() => setSelectedPhase(null)} />
    </div>
  );
}
