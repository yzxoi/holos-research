import { For, Show } from "solid-js";
import type { JournalEntry, PhaseName } from "../types";
import { relativeTime } from "../utils";
import Icon, { type IconName } from "./icons";

interface JournalFeedProps {
  entries: JournalEntry[];
  phaseFilter?: PhaseName | null;
  maxHeight?: number;
}

const KIND_CONFIG: Record<string, { label: string; color: string; icon: IconName }> = {
  idea_rationale: { label: "IDEA", color: "var(--holos-info)", icon: "bulb" },
  decision_rationale: { label: "DEC", color: "var(--holos-warning)", icon: "compass" },
  failure_analysis: { label: "FAIL", color: "var(--holos-danger)", icon: "alert" },
  design_note: { label: "DSG", color: "var(--holos-cyan)", icon: "eye" },
  experiment_note: { label: "EXP", color: "var(--holos-success)", icon: "milestone" },
  claim_note: { label: "CLM", color: "var(--holos-info)", icon: "sticky" },
  paper_note: { label: "PAP", color: "var(--text-subtle)", icon: "sticky" },
  handoff: { label: "OFF", color: "var(--holos-warning)", icon: "compass" },
  note: { label: "NOTE", color: "var(--text-subtle)", icon: "sticky" },
};

const DEFAULT_KIND: { label: string; color: string; icon: IconName } = {
  label: "NOTE",
  color: "var(--text-subtle)",
  icon: "sticky",
};

const IMPORTANCE_WEIGHT: Record<string, number> = {
  critical: 3,
  important: 2,
  normal: 1,
};

const IMPORTANCE_COLOR: Record<string, string> = {
  critical: "var(--holos-danger)",
  important: "var(--holos-warning)",
  normal: "var(--text-weaker)",
};

/**
 * NOTE: props must be read through the `props` object inside reactive scopes —
 * Solid component functions run once at mount, so destructuring would freeze
 * the initial values and later prop updates (phaseFilter) would never re-render.
 */
export default function JournalFeed(props: JournalFeedProps) {
  const filtered = () =>
    props.phaseFilter ? props.entries.filter((e) => e.phase === props.phaseFilter) : props.entries;
  const sorted = () =>
    [...filtered()].sort((a, b) => {
      const impDiff =
        (IMPORTANCE_WEIGHT[b.importance ?? "normal"] ?? 1) - (IMPORTANCE_WEIGHT[a.importance ?? "normal"] ?? 1);
      if (impDiff !== 0) return impDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div class="holos-journal" style={{ "max-height": `${props.maxHeight}px` }}>
      <Show
        when={sorted().length > 0}
        fallback={
          <div class="holos-journal__empty">
            <Icon name="sticky" size={18} color="var(--text-weaker)" strokeWidth={1.5} />
            No journal entries
          </div>
        }
      >
        <For each={sorted()}>
          {(entry, idx) => {
            const cfg = KIND_CONFIG[entry.kind] ?? DEFAULT_KIND;
            const importance = entry.importance ?? "normal";
            const impColor = IMPORTANCE_COLOR[importance] ?? "var(--text-weaker)";
            const isCritical = importance === "critical";
            return (
              <div
                class="holos-journal__entry"
                style={{
                  "animation-delay": `${Math.min(idx() * 0.02, 0.3)}s`,
                  background: isCritical
                    ? "linear-gradient(180deg, rgba(248,113,113,0.06), var(--surface-inset-base))"
                    : "var(--surface-inset-base)",
                  border: `1px solid ${isCritical ? "rgba(248,113,113,0.3)" : "var(--border-base)"}`,
                }}
              >
                <div class="holos-journal__bar" style={{ background: impColor }} />
                <Show when={isCritical}>
                  <span class="holos-journal__critical" style={{ color: "var(--holos-danger)" }}>
                    <Icon name="alert" size={10} color="var(--holos-danger)" strokeWidth={2.5} />
                    CRITICAL
                  </span>
                </Show>
                <div class="holos-journal__meta">
                  <span
                    class="holos-tag"
                    style={{
                      color: cfg.color,
                      background: `${cfg.color}15`,
                      border: `1px solid ${cfg.color}30`,
                    }}
                  >
                    <Icon name={cfg.icon} size={9} color={cfg.color} strokeWidth={2.4} />
                    {cfg.label}
                  </span>
                  <span class="holos-meta">{entry.author}</span>
                  <Show when={entry.phase}>
                    <span class="holos-pill">{entry.phase}</span>
                  </Show>
                </div>
                <div class="holos-journal__summary">{entry.summary}</div>
                <Show when={entry.note}>
                  <div class="holos-journal__note">{entry.note}</div>
                </Show>
                <div class="holos-journal__time" title={new Date(entry.createdAt).toLocaleString()}>
                  {relativeTime(entry.createdAt)}
                </div>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
