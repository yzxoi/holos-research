import { For, Show } from "solid-js";
import { PHASE_DISPLAY_NAMES } from "../constants";
import type { PhaseName, TimelineEvent } from "../types";
import { relativeTime } from "../utils";
import Icon, { type IconName } from "./icons";

interface TimelineFeedProps {
  events: TimelineEvent[];
  phaseFilter?: PhaseName | null;
  maxHeight?: number;
}

interface EventStyle {
  icon: IconName;
  color: string;
  tag: string;
  category: "system" | "entity" | "lifecycle" | "wiki" | "insight";
}

const EVENT_CONFIG: Record<string, EventStyle> = {
  // System
  "research.init": { icon: "target", color: "var(--holos-accent)", tag: "Init", category: "system" },
  "focus.changed": { icon: "arrowRight", color: "var(--holos-info)", tag: "Focus", category: "system" },

  // Idea
  "idea.created": { icon: "bulb", color: "var(--holos-cyan)", tag: "Idea+", category: "entity" },
  "idea.status": { icon: "bulb", color: "var(--text-subtle)", tag: "Idea", category: "lifecycle" },
  "idea.reviewed": { icon: "bulb", color: "var(--text-subtle)", tag: "Idea Rev", category: "lifecycle" },

  // Plan
  "plan.created": { icon: "workflow", color: "var(--holos-cyan)", tag: "Plan+", category: "entity" },
  "plan.status": { icon: "workflow", color: "var(--text-subtle)", tag: "Plan", category: "lifecycle" },
  "plan.reviewed": { icon: "workflow", color: "var(--text-subtle)", tag: "Plan Rev", category: "lifecycle" },

  // Experiment
  "exp.created": { icon: "flask", color: "var(--holos-cyan)", tag: "Exp+", category: "entity" },
  "exp.status": { icon: "flask", color: "var(--text-subtle)", tag: "Exp", category: "lifecycle" },
  "exp.reviewed": { icon: "flask", color: "var(--text-subtle)", tag: "Exp Rev", category: "lifecycle" },

  // Claim
  "claim.created": { icon: "check", color: "var(--holos-cyan)", tag: "Claim+", category: "entity" },
  "claim.status": { icon: "check", color: "var(--text-subtle)", tag: "Claim", category: "lifecycle" },
  "claim.reviewed": { icon: "check", color: "var(--text-subtle)", tag: "Claim Rev", category: "lifecycle" },

  // Exhibit
  "exhibit.created": { icon: "image", color: "var(--holos-cyan)", tag: "Exh+", category: "entity" },
  "exhibit.status": { icon: "image", color: "var(--text-subtle)", tag: "Exh", category: "lifecycle" },
  "exhibit.reviewed": { icon: "image", color: "var(--text-subtle)", tag: "Exh Rev", category: "lifecycle" },

  // Paper
  "paper.created": { icon: "book", color: "var(--holos-cyan)", tag: "Paper+", category: "entity" },
  "paper.status": { icon: "book", color: "var(--text-subtle)", tag: "Paper", category: "lifecycle" },
  "paper.reviewed": { icon: "book", color: "var(--text-subtle)", tag: "Paper Rev", category: "lifecycle" },

  // Submission
  "submission.created": { icon: "send", color: "var(--holos-cyan)", tag: "Sub+", category: "entity" },
  "submission.status": { icon: "send", color: "var(--text-subtle)", tag: "Sub", category: "lifecycle" },
  "submission.reviewed": { icon: "send", color: "var(--text-subtle)", tag: "Sub Rev", category: "lifecycle" },

  // Wiki
  "wiki.paper_ingested": { icon: "book", color: "var(--holos-info)", tag: "Ingest", category: "wiki" },
  "wiki.gap_registered": { icon: "spark", color: "var(--holos-warning)", tag: "Gap", category: "wiki" },

  // Free events
  insight: { icon: "spark", color: "var(--holos-info)", tag: "Insight", category: "insight" },
  milestone: { icon: "milestone", color: "var(--holos-success)", tag: "Milestone", category: "insight" },
  decision: { icon: "list", color: "var(--holos-warning)", tag: "Decision", category: "insight" },

  // Legacy aliases
  phase_start: { icon: "play", color: "var(--holos-accent)", tag: "Phase", category: "system" },
  phase_complete: { icon: "checkCircle", color: "var(--holos-success)", tag: "Done", category: "system" },
  entity_created: { icon: "plus", color: "var(--holos-cyan)", tag: "New", category: "entity" },
  entity_updated: { icon: "pencil", color: "var(--text-subtle)", tag: "Update", category: "lifecycle" },
  checkpoint: { icon: "flag", color: "var(--holos-warning)", tag: "Checkpoint", category: "system" },
  context_refresh: { icon: "refresh", color: "var(--holos-info)", tag: "Refresh", category: "system" },
  error: { icon: "alert", color: "var(--holos-danger)", tag: "Error", category: "system" },
  note: { icon: "file", color: "var(--text-subtle)", tag: "Note", category: "insight" },
};

const DEFAULT_STYLE: EventStyle = {
  icon: "circle",
  color: "var(--text-weaker)",
  tag: "Event",
  category: "system",
};

const CATEGORY_BG: Record<string, string> = {
  system: "rgba(90, 166, 240, 0.10)",
  entity: "rgba(45, 212, 191, 0.10)",
  lifecycle: "rgba(154, 165, 181, 0.08)",
  wiki: "rgba(167, 139, 250, 0.10)",
  insight: "rgba(251, 191, 36, 0.10)",
};

const LEVEL_COLORS: Record<string, string> = {
  trace: "var(--text-weaker)",
  info: "var(--text-subtle)",
  decision: "var(--holos-warning)",
  gate: "var(--holos-info)",
  pivot: "var(--holos-magenta)",
  human: "var(--holos-accent)",
  critical: "var(--holos-danger)",
};

/**
 * NOTE: props must be read through the `props` object inside reactive scopes —
 * Solid component functions run once at mount, so destructuring would freeze
 * the initial values and later prop updates (phaseFilter) would never re-render.
 */
export default function TimelineFeed(props: TimelineFeedProps) {
  const filtered = () => (props.phaseFilter ? props.events.filter((e) => e.phase === props.phaseFilter) : props.events);
  const sorted = () =>
    [...filtered()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div class="holos-timeline" style={{ "max-height": `${props.maxHeight}px` }}>
      <Show
        when={sorted().length > 0}
        fallback={
          <div class="holos-timeline__empty">
            <Icon name="circle" size={18} color="var(--text-weaker)" strokeWidth={1.5} />
            No events recorded yet
          </div>
        }
      >
        <div class="holos-timeline__rail" />
        <For each={sorted()}>
          {(evt, idx) => {
            const style = EVENT_CONFIG[evt.type] ?? DEFAULT_STYLE;
            const levelColor = evt.level ? LEVEL_COLORS[evt.level] : undefined;
            const tagBg = CATEGORY_BG[style.category] ?? CATEGORY_BG.system;
            return (
              <div class="holos-timeline__node" style={{ "animation-delay": `${Math.min(idx() * 0.02, 0.4)}s` }}>
                <div
                  class="holos-timeline__dot"
                  style={{ border: `1px solid ${style.color}50`, "box-shadow": "0 0 0 3px var(--surface-inset-base)" }}
                >
                  <Icon name={style.icon} size={10} color={style.color} strokeWidth={2.2} />
                </div>
                <div class="holos-timeline__body">
                  <div class="holos-timeline__row1">
                    <span
                      class="holos-tag"
                      style={{ background: tagBg, color: style.color, border: `1px solid ${style.color}22` }}
                    >
                      {style.tag}
                    </span>
                    <span class="holos-timeline__summary">{evt.summary || evt.type}</span>
                    <Show when={evt.phase}>
                      <span class="holos-pill">{PHASE_DISPLAY_NAMES[evt.phase as PhaseName] ?? evt.phase}</span>
                    </Show>
                    <Show when={levelColor}>
                      <span
                        class="holos-dot"
                        style={{ background: levelColor, "box-shadow": `0 0 6px ${levelColor}` }}
                        title={evt.level}
                      />
                    </Show>
                  </div>
                  <div class="holos-timeline__row2">
                    <span class="holos-meta" title={new Date(evt.timestamp).toLocaleString()}>
                      {relativeTime(evt.timestamp)}
                    </span>
                    <Show when={evt.refs.length > 0}>
                      <span class="holos-meta holos-meta--dim">
                        {evt.refs.slice(0, 2).join(", ")}
                        {evt.refs.length > 2 ? ` +${evt.refs.length - 2}` : ""}
                      </span>
                    </Show>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
