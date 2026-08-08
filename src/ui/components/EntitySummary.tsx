import { For, Show } from "solid-js";
import { ENTITY_KIND_COLORS } from "../constants";
import type { EntityKind, EntitySummaryData, TimelineEvent } from "../types";
import Icon, { type IconName } from "./icons";
import SparkArea from "./SparkArea";

interface EntitySummaryProps {
  summaries: EntitySummaryData[];
  activeFilter: EntityKind | null;
  onFilter: (kind: EntityKind | null) => void;
  timeline?: TimelineEvent[];
}

const KIND_ICONS: Record<EntityKind, IconName> = {
  idea: "bulb",
  plan: "list",
  experiment: "flask",
  claim: "milestone",
  exhibit: "image",
  paper: "file",
  submission: "send",
};

const KIND_SYMBOL: Record<EntityKind, string> = {
  idea: "◈",
  plan: "▣",
  experiment: "◉",
  claim: "◆",
  exhibit: "▤",
  paper: "▩",
  submission: "◊",
};

const KIND_TYPE_PREFIX: Record<EntityKind, string[]> = {
  idea: ["idea."],
  plan: ["plan."],
  experiment: ["exp."],
  claim: ["claim."],
  exhibit: ["exhibit."],
  paper: ["paper."],
  submission: ["submission."],
};

const BUCKETS = 12;

function buildSpark(timeline: TimelineEvent[] | undefined, kind: EntityKind): number[] {
  if (!timeline || timeline.length === 0) {
    return Array(BUCKETS).fill(0);
  }
  const prefixes = KIND_TYPE_PREFIX[kind];
  const matches = timeline.filter((ev) => prefixes.some((p) => ev.type?.startsWith(p)));
  if (matches.length === 0) {
    return Array(BUCKETS).fill(0);
  }
  const sorted = [...matches].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const firstTs = new Date(sorted[0]?.timestamp ?? "").getTime();
  const lastTs = new Date(sorted[sorted.length - 1]?.timestamp ?? "").getTime();
  if (!firstTs && !lastTs) return Array(BUCKETS).fill(0);
  const span = Math.max(lastTs - firstTs, 1);
  const buckets = Array(BUCKETS).fill(0);
  sorted.forEach((ev) => {
    const t = new Date(ev.timestamp).getTime();
    const idx = Math.min(BUCKETS - 1, Math.floor(((t - firstTs) / span) * BUCKETS));
    buckets[idx] += 1;
  });
  return buckets;
}

/**
 * NOTE: props must be read through the `props` object inside reactive scopes
 * (`isActive()` getters), never destructured at the component top — Solid
 * component functions run once at mount, so destructuring would freeze the
 * initial `activeFilter` (null) and filtering would never highlight cards.
 */
export default function EntitySummary(props: EntitySummaryProps) {
  return (
    <div class="holos-entity-grid">
      <For each={props.summaries}>
        {(s, idx) => {
          const color = ENTITY_KIND_COLORS[s.kind];
          const isActive = () => props.activeFilter === s.kind;
          const isFiltering = () => props.activeFilter !== null && props.activeFilter !== s.kind;
          const spark = buildSpark(props.timeline, s.kind);
          return (
            <button
              type="button"
              class="holos-entity-card"
              classList={{ "holos-entity-card--active": isActive(), "holos-entity-card--dimmed": isFiltering() }}
              style={{
                "animation-delay": `${idx() * 0.04}s`,
                background: isActive() ? `${color}10` : "var(--surface-inset-base)",
                border: `1px solid ${isActive() ? `${color}50` : "var(--border-base)"}`,
              }}
              onClick={() => props.onFilter(isActive() ? null : s.kind)}
              aria-pressed={isActive()}
              aria-label={`Filter by ${s.displayName}`}
            >
              <Show when={isActive()}>
                <div
                  class="holos-entity-card__accent"
                  style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
                />
              </Show>
              <div class="holos-entity-card__head">
                <span class="holos-entity-card__label" style={{ color: isActive() ? color : "var(--text-subtle)" }}>
                  <Icon
                    name={KIND_ICONS[s.kind]}
                    size={12}
                    color={isActive() ? color : "var(--text-subtle)"}
                    strokeWidth={2}
                  />
                  {s.displayName}
                </span>
                <span class="holos-entity-card__symbol" style={{ color: isActive() ? color : "var(--text-weaker)" }}>
                  {KIND_SYMBOL[s.kind]}
                </span>
              </div>
              <div class="holos-entity-card__count">
                <span
                  class="holos-entity-card__number"
                  style={{ color: isActive() ? color : s.total > 0 ? "var(--text-strong)" : "var(--text-weaker)" }}
                >
                  {s.total}
                </span>
                <span class="holos-entity-card__unit">total</span>
              </div>
              <div class="holos-entity-card__spark" style={{ opacity: spark.every((v) => v === 0) ? 0.3 : 1 }}>
                <SparkArea
                  data={spark}
                  color={isActive() ? color : "var(--text-weaker)"}
                  height={22}
                  gradientId={`holos-spark-${s.kind}`}
                />
              </div>
              <div class="holos-entity-card__statuses">
                <For
                  each={Object.entries(s.byStatus)
                    .filter(([, count]) => count > 0)
                    .slice(0, 3)}
                >
                  {([status, count]) => (
                    <span
                      class="holos-chip"
                      style={{ background: "var(--surface-base)", border: "1px solid var(--border-weak-base)" }}
                    >
                      <span style={{ color: "var(--text-subtle)" }}>{count}</span> {status}
                    </span>
                  )}
                </For>
              </div>
            </button>
          );
        }}
      </For>
    </div>
  );
}
