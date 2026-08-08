import { createSignal, For, Show } from "solid-js";
import type { ResearchBrief as ResearchBriefData } from "../types";
import { timeAgo } from "../utils";
import Icon from "./icons";

interface ResearchBriefProps {
  brief: ResearchBriefData | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  active: "var(--holos-accent)",
  warning: "var(--holos-danger)",
  human: "var(--holos-warning)",
  promoted: "var(--holos-success)",
  pivoted: "var(--holos-warning)",
  aborted: "var(--holos-danger)",
};

function severityColor(severity?: string): string {
  return SEVERITY_COLORS[severity ?? ""] ?? "var(--text-weaker)";
}

/**
 * NOTE: props must be read through the `props` object — Solid component
 * functions run once at mount, so destructuring would freeze the initial
 * value (null) and the async-loaded brief would never appear.
 */
export default function ResearchBrief(props: ResearchBriefProps) {
  const [doneExpanded, setDoneExpanded] = createSignal(false);
  if (!props.brief) return null;

  const doneItems = props.brief.done;
  const showCollapse = doneItems.length > 3;
  const visibleDone = () => (doneExpanded() ? doneItems : doneItems.slice(0, 3));

  return (
    <section class="holos-brief">
      <div class="holos-brief__line" />
      <div class="holos-brief__head">
        <p class="holos-brief__summary">{props.brief.summary}</p>
        <span class="holos-meta">
          <Icon name="refresh" size={9} color="var(--text-weaker)" />
          {timeAgo(props.brief.generatedAt)}
        </span>
      </div>
      <div class="holos-brief__cols">
        <div class="holos-brief__col">
          <div class="holos-brief__label">
            <Icon name="zap" size={11} color="var(--holos-accent)" strokeWidth={2.2} />
            DOING
            <span class="holos-meta">{props.brief.doing.length}</span>
          </div>
          <Show when={props.brief.doing.length > 0} fallback={<p class="holos-brief__empty">No active items</p>}>
            <For each={props.brief.doing}>
              {(item, i) => (
                <div class="holos-brief__row">
                  <span
                    class="holos-brief__dot"
                    style={{
                      background: severityColor(item.severity),
                      "box-shadow": item.severity === "active" ? `0 0 6px ${severityColor(item.severity)}` : "none",
                    }}
                  />
                  <span class="holos-brief__text">{item.text}</span>
                  <Show when={item.since}>
                    <span class="holos-meta">{timeAgo(item.since)}</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
        <div class="holos-brief__col">
          <div class="holos-brief__label">
            <Icon name="checkCircle" size={11} color="var(--holos-success)" strokeWidth={2.2} />
            DONE
            <span class="holos-meta">{doneItems.length}</span>
          </div>
          <Show when={doneItems.length > 0} fallback={<p class="holos-brief__empty">No completed items</p>}>
            <For each={visibleDone()}>
              {(item) => (
                <div class="holos-brief__row">
                  <span class="holos-brief__dot" style={{ background: severityColor(item.severity) }} />
                  <span class="holos-brief__text">{item.text}</span>
                  <Show when={item.since}>
                    <span class="holos-meta">{timeAgo(item.since)}</span>
                  </Show>
                </div>
              )}
            </For>
            <Show when={showCollapse}>
              <button type="button" class="holos-brief__toggle" onClick={() => setDoneExpanded((v: boolean) => !v)}>
                <Icon name="chevronDown" size={10} color="var(--text-subtle)" />
                {doneExpanded() ? "Show less" : `+${doneItems.length - 3} more`}
              </button>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}
