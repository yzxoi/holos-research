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

/**
 * NOTE: props must be accessed through the `props` object, never destructured —
 * Solid component functions run once at mount, so destructuring captures the
 * initial values and loses reactivity for later prop updates (e.g. the phase
 * drawer would never open and entity filtering would never highlight).
 */
export default function WorkflowBoard(props: WorkflowBoardProps) {
  const [selectedPhase, setSelectedPhase] = createSignal<PhaseInfo | null>(null);
  const [entityFilter, setEntityFilter] = createSignal<EntityKind | null>(null);
  const ENTITY_EVENT_PREFIXES: Record<EntityKind, string[]> = {
    idea: ["idea."],
    plan: ["plan."],
    experiment: ["exp."],
    claim: ["claim."],
    exhibit: ["exhibit."],
    paper: ["paper."],
    submission: ["submission."],
  };

  const ENTITY_JOURNAL_PREFIXES: Record<EntityKind, string[]> = {
    idea: ["idea_"],
    experiment: ["experiment_"],
    claim: ["claim_"],
    paper: ["paper_"],
    plan: [],
    exhibit: [],
    submission: [],
  };

  const filteredTimeline = () => {
    const kind = entityFilter();
    if (!kind) return props.data.timeline;
    const prefixes = ENTITY_EVENT_PREFIXES[kind];
    return props.data.timeline.filter((ev) => prefixes.some((p) => ev.type?.startsWith(p)));
  };

  const filteredJournal = () => {
    const kind = entityFilter();
    if (!kind) return props.data.journal;
    const prefixes = ENTITY_JOURNAL_PREFIXES[kind];
    if (prefixes.length === 0) return [];
    return props.data.journal.filter((e) => prefixes.some((p) => e.kind?.startsWith(p)));
  };

  const activePhase = () => props.data.phases.find((p) => p.status === "active");
  const completedCount = () => props.data.phases.filter((p) => p.status === "completed").length;
  const totalPhases = () => props.data.phases.length;
  const progressPct = () => (totalPhases() > 0 ? completedCount() / totalPhases() : 0);

  const ringColor =
    progressPct() >= 0.8
      ? "var(--holos-success)"
      : progressPct() >= 0.4
        ? "var(--holos-accent)"
        : "var(--holos-warning)";

  const entityTotal = () => props.data.entitySummaries.reduce((sum, s) => sum + s.total, 0);

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
          <h1 class="holos-header__project" title={props.data.anchor}>
            {props.data.projectSummary ?? props.data.projectName}
          </h1>
          <Show when={props.data.anchor}>
            <p class="holos-header__anchor">{props.data.anchor}</p>
          </Show>
        </div>

        <div class="holos-header__stats">
          <div class="holos-header__completion">
            <ProgressRing
              value={completedCount()}
              max={totalPhases()}
              size={62}
              strokeWidth={4}
              color={ringColor}
              label={`${completedCount()}/${totalPhases()}`}
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
                phase {props.data.phases.indexOf(activePhase() as PhaseInfo) + 1} of {totalPhases()}
              </span>
            </div>
          </Show>
          <div class="holos-header__sync">
            <span class="holos-meta">LAST SYNC</span>
            <span class="holos-header__sync-time">
              <Icon name="clock" size={10} color="var(--text-weaker)" strokeWidth={2} />
              {clockTime(props.data.lastUpdated)}
            </span>
            <span class="holos-meta">event-driven</span>
          </div>
        </div>
      </header>

      {/* ═══ RESEARCH BRIEF ════════════════════════════════ */}
      <ResearchBrief brief={props.brief} />

      {/* ═══ PHASE FLOW ══════════════════════════════════ */}
      <section class="holos-section">
        <PhaseFlow phases={props.data.phases} phaseRunCards={props.data.phaseRunCards} onSelect={setSelectedPhase} />
      </section>

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
          summaries={props.data.entitySummaries}
          activeFilter={entityFilter()}
          onFilter={setEntityFilter}
          timeline={props.data.timeline}
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
            <span class="holos-meta">
              {filteredTimeline().length}
              {entityFilter() ? ` / ${props.data.timeline.length}` : ""} events
            </span>
          </div>
          <TimelineFeed events={filteredTimeline()} />
        </div>
        <div class="holos-card holos-card--feed">
          <div class="holos-card__head">
            <h2 class="holos-section-title">
              <Icon name="book" size={11} color="var(--text-subtle)" strokeWidth={2.2} />
              Journal
            </h2>
            <span class="holos-meta">
              {filteredJournal().length}
              {entityFilter() ? ` / ${props.data.journal.length}` : ""} entries
            </span>
          </div>
          <JournalFeed entries={filteredJournal()} />
        </div>
      </section>

      {/* ═══ DRAWER ══════════════════════════════════════ */}
      <PhaseDetailDrawer phase={selectedPhase()} data={props.data} onClose={() => setSelectedPhase(null)} />
    </div>
  );
}
