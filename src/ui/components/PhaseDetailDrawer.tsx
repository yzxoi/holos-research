import { For, onCleanup, onMount, Show } from "solid-js";
import type { HumanCheckpoint, MonitorData, PhaseInfo } from "../types";
import DiagnosisLadder from "./DiagnosisLadder";
import Icon, { type IconName } from "./icons";
import ProgressRing from "./ProgressRing";
import StatusBadge from "./StatusBadge";
import StoryRadar from "./StoryRadar";
import TimelineFeed from "./TimelineFeed";

interface PhaseDetailDrawerProps {
  phase: PhaseInfo | null;
  data: MonitorData;
  onClose: () => void;
}

const INNER_LOOP_COLORS: Record<string, string> = {
  attempt: "var(--holos-warning)",
  evaluate: "var(--holos-accent)",
  decide: "var(--holos-info)",
  blocked: "var(--holos-warning)",
  promoted: "var(--holos-success)",
  pivoted: "var(--holos-success)",
  aborted: "var(--holos-danger)",
};

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: IconName;
  count?: number;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <section class="holos-drawer-section">
      <h3 class="holos-section-title">
        <Icon name={icon} size={11} color="var(--text-subtle)" strokeWidth={2.4} />
        {title}
        <Show when={count !== undefined}>
          <span class="holos-meta">{count}</span>
        </Show>
      </h3>
      {children}
    </section>
  );
}

function Pair({ label, value, mono = true }: { label: string; value: import("solid-js").JSX.Element; mono?: boolean }) {
  return (
    <div class="holos-pair">
      <span class="holos-pair__label">{label}</span>
      <span class="holos-pair__value" style={{ "font-family": mono ? "var(--font-family-mono)" : "inherit" }}>
        {value}
      </span>
    </div>
  );
}

function CheckpointCard({ chk }: { chk: HumanCheckpoint }) {
  const color =
    chk.status === "pending"
      ? "var(--holos-warning)"
      : chk.status === "confirmed"
        ? "var(--holos-success)"
        : "var(--text-weaker)";
  const icon: IconName = chk.status === "pending" ? "flag" : chk.status === "confirmed" ? "checkCircle" : "xCircle";
  const rc = () => chk.resourceCommitment;

  return (
    <div class="holos-checkpoint" style={{ border: `1px solid ${color}33` }}>
      <div class="holos-checkpoint__icon" style={{ background: `${color}15`, border: `1px solid ${color}33` }}>
        <Icon name={icon} size={12} color={color} strokeWidth={2.4} />
      </div>
      <div class="holos-checkpoint__body">
        <div class="holos-checkpoint__head">
          <span class="holos-checkpoint__kind" style={{ color }}>
            {chk.kind}
          </span>
          <span class="holos-checkpoint__status" style={{ background: "var(--surface-base)", color }}>
            {chk.status.toUpperCase()}
          </span>
        </div>
        <div class="holos-checkpoint__question">{chk.question ?? ""}</div>
        <Show when={chk.decision}>
          <div class="holos-checkpoint__decision">
            → <span style={{ color: "var(--text-subtle)" }}>{chk.decision}</span>
          </div>
        </Show>
        <Show when={chk.rationale}>
          <div class="holos-checkpoint__rationale">{chk.rationale}</div>
        </Show>
        <Show when={rc()}>
          <div
            class="holos-checkpoint__resource"
            style={{ background: "var(--surface-base)", border: "1px solid var(--border-weak-base)" }}
          >
            <div class="holos-checkpoint__resource-title">
              <Icon name="cpu" size={9} color="var(--text-subtle)" strokeWidth={2.4} />
              RESOURCE COMMITMENT
              <Show when={rc()?.budgetApproved}>
                <span style={{ color: "var(--holos-success)", "margin-left": "6px", "letter-spacing": "0.06em" }}>
                  ✓ APPROVED
                </span>
              </Show>
            </div>
            <Show when={rc()}>
              {(r) => (
                <div class="holos-checkpoint__resource-grid">
                  <span style={{ color: "var(--text-subtle)" }}>
                    GPU:{" "}
                    <span style={{ color: "var(--text-subtle)" }}>
                      {r().resourceSpec.gpuType} × {r().resourceSpec.gpuCount}
                    </span>
                  </span>
                  <Show when={(r().resourceSpec.nodes ?? 1) > 1}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      Nodes: <span style={{ color: "var(--text-subtle)" }}>{r().resourceSpec.nodes}</span>
                    </span>
                  </Show>
                  <Show when={r().resourceSpec.estimatedGpuHours !== undefined}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      Est. Hours:{" "}
                      <span style={{ color: "var(--text-subtle)" }}>{r().resourceSpec.estimatedGpuHours}</span>
                    </span>
                  </Show>
                  <Show when={r().resourceSpec.timeoutHours !== undefined}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      Timeout: <span style={{ color: "var(--text-subtle)" }}>{r().resourceSpec.timeoutHours}h</span>
                    </span>
                  </Show>
                  <Show when={r().connectionMethod}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      Method: <span style={{ color: "var(--text-subtle)" }}>{r().connectionMethod}</span>
                    </span>
                  </Show>
                  <Show when={r().computeGroup}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      Group: <span style={{ color: "var(--text-subtle)" }}>{r().computeGroup}</span>
                    </span>
                  </Show>
                  <Show when={r().image}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      Image: <span style={{ color: "var(--text-subtle)" }}>{r().image}</span>
                    </span>
                  </Show>
                  <Show when={r().workspace}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      Workspace: <span style={{ color: "var(--text-subtle)" }}>{r().workspace}</span>
                    </span>
                  </Show>
                  <Show when={r().connectionUrl}>
                    <span style={{ color: "var(--text-subtle)" }}>
                      URL:{" "}
                      <span style={{ color: "var(--holos-accent)", "word-break": "break-all" }}>
                        {r().connectionUrl}
                      </span>
                    </span>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>
        <Show when={chk.briefRef}>
          <div class="holos-checkpoint__brief-ref">
            <Icon name="file" size={10} color="var(--holos-accent)" strokeWidth={2.2} />
            {chk.briefRef}
          </div>
        </Show>
      </div>
    </div>
  );
}

export default function PhaseDetailDrawer(props: PhaseDetailDrawerProps) {
  const phaseEntities = () => {
    const phase = props.phase;
    return phase ? props.data.entities.filter((e) => e.phase === phase.name) : [];
  };

  onMount(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  return (
    <Show when={props.phase}>
      {(p) => {
        const run = () => p().run;
        const stories = () => p().stories ?? [];
        const rqgs = () => p().rqg ?? [];
        const diagnoses = () => p().diagnosis ?? [];
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close, Escape key provided onKeyDown
          <div
            class="holos-drawer-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) props.onClose();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") props.onClose();
            }}
          >
            <div class="holos-drawer" role="dialog" aria-modal="true" aria-label={`${p().displayName} phase inspector`}>
              <div class="holos-drawer__head">
                <div class="holos-drawer__title-wrap">
                  <div class="holos-drawer__title-row">
                    <span class="holos-meta">PHASE INSPECTOR</span>
                    <StatusBadge status={p().status} size="sm" />
                  </div>
                  <h2 class="holos-drawer__title">{p().displayName}</h2>
                </div>
                <button type="button" class="holos-drawer__close" onClick={props.onClose} aria-label="Close">
                  <Icon name="x" size={16} color="var(--text-subtle)" strokeWidth={2.2} />
                </button>
              </div>

              <div class="holos-drawer__body">
                <div class="holos-drawer__desc">
                  <p>{p().description}</p>
                  <Show when={p().keyQuestion}>
                    <div class="holos-drawer__key-question">
                      <Icon name="help" size={14} color="var(--holos-accent)" strokeWidth={2.2} />
                      <div>
                        <div class="holos-meta" style={{ color: "var(--holos-accent)" }}>
                          KEY QUESTION
                        </div>
                        <p>{p().keyQuestion}</p>
                      </div>
                    </div>
                  </Show>
                </div>

                <Show when={p().promoteCriteria.length > 0}>
                  <Section title="Promote Criteria" icon="target" count={p().promoteCriteria.length}>
                    <div class="holos-drawer__criteria">
                      <For each={p().promoteCriteria}>
                        {(c) => (
                          <div class="holos-drawer__criterion">
                            <span class="holos-drawer__criterion-check">
                              <Icon name="check" size={10} color="var(--holos-success)" strokeWidth={2.6} />
                            </span>
                            <span>{c}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Section>
                </Show>

                <Show when={run()}>
                  {(r) => (
                    <Section title="Phase Run" icon="cpu">
                      <div class="holos-drawer__run-grid">
                        <Pair label="RUN ID" value={<span style={{ "word-break": "break-all" }}>{r().id}</span>} />
                        <Pair label="STATUS" value={<span>{r().status}</span>} />
                        <Pair label="CREATED" value={<span>{new Date(r().created).toLocaleString()}</span>} />
                        <Pair label="UPDATED" value={<span>{new Date(r().updated).toLocaleString()}</span>} />
                      </div>

                      <Show when={r().innerLoop}>
                        {(il) => (
                          <div class="holos-drawer__innerloop">
                            <div class="holos-drawer__innerloop-head">
                              <span class="holos-meta">
                                <Icon name="refresh" size={11} color="var(--holos-accent)" strokeWidth={2.2} />
                                INNER LOOP
                              </span>
                              <span
                                class="holos-drawer__innerloop-state"
                                style={{
                                  color: INNER_LOOP_COLORS[il().state] ?? "var(--text-weaker)",
                                  background: `${INNER_LOOP_COLORS[il().state] ?? "var(--text-weaker)"}1a`,
                                  border: `1px solid ${INNER_LOOP_COLORS[il().state] ?? "var(--text-weaker)"}40`,
                                }}
                              >
                                {il().state === "blocked" ? "⏸ " : ""}
                                {il().state.toUpperCase()}
                              </span>
                            </div>
                            <div class="holos-drawer__innerloop-body">
                              <ProgressRing
                                value={il().attempts}
                                max={il().maxAttempts}
                                size={56}
                                strokeWidth={4}
                                color={
                                  il().attempts / il().maxAttempts >= 0.8
                                    ? "var(--holos-warning)"
                                    : "var(--holos-accent)"
                                }
                                label={`${il().attempts}/${il().maxAttempts}`}
                                sublabel="ATT"
                              />
                              <div class="holos-drawer__innerloop-fields">
                                <Pair label="ROUND" value={<span>R{il().round}</span>} />
                                <Pair
                                  label="STAGNATION"
                                  value={
                                    <span
                                      style={{
                                        color:
                                          il().stagnationRounds > 0 ? "var(--holos-warning)" : "var(--text-subtle)",
                                      }}
                                    >
                                      {il().stagnationRounds} / {il().maxStagnation}
                                    </span>
                                  }
                                />
                                <Show when={il().lastDecision}>
                                  <Pair label="LAST DECISION" value={<span>{il().lastDecision}</span>} />
                                </Show>
                                <Show when={il().progressMetric}>
                                  {(pm) => (
                                    <Pair
                                      label={pm().name.toUpperCase()}
                                      value={
                                        <span>
                                          <span
                                            style={{
                                              color:
                                                pm().current > pm().previous
                                                  ? "var(--holos-success)"
                                                  : "var(--text-subtle)",
                                            }}
                                          >
                                            {pm().current}
                                          </span>
                                          <span style={{ color: "var(--text-weaker)" }}> ← {pm().previous}</span>
                                        </span>
                                      }
                                    />
                                  )}
                                </Show>
                              </div>
                            </div>
                            <Show when={il().summary}>
                              <p class="holos-drawer__innerloop-summary">{il().summary}</p>
                            </Show>
                          </div>
                        )}
                      </Show>
                    </Section>
                  )}
                </Show>

                <Show when={stories().length > 0}>
                  <Section title="Story Spines" icon="bulb" count={stories().length}>
                    <div class="holos-drawer__stories">
                      <For each={stories()}>
                        {(story) => {
                          const statusColor =
                            story.status === "selected"
                              ? "var(--holos-success)"
                              : story.status === "grounding"
                                ? "var(--holos-accent)"
                                : story.status === "rejected"
                                  ? "var(--holos-danger)"
                                  : "var(--text-subtle)";
                          const hasRadar = Object.keys(story.scores).length >= 3;
                          return (
                            <div
                              class="holos-drawer__story"
                              style={{
                                background: "var(--surface-inset-base)",
                                border: "1px solid var(--border-base)",
                              }}
                            >
                              <div class="holos-drawer__story-head">
                                <span style={{ color: "var(--text-strong)" }}>{story.fieldAssumption}</span>
                                <span
                                  class="holos-checkpoint__status"
                                  style={{
                                    background: "var(--surface-base)",
                                    color: statusColor,
                                    border: `1px solid ${statusColor}30`,
                                  }}
                                >
                                  {story.status.toUpperCase()}
                                </span>
                              </div>
                              <div
                                class="holos-drawer__story-body"
                                style={{ "grid-template-columns": hasRadar ? "1fr 200px" : "1fr" }}
                              >
                                <div class="holos-drawer__story-text">
                                  <p style={{ color: "var(--text-subtle)" }}>
                                    <span style={{ color: "var(--holos-warning)" }}>Pain · </span>
                                    {story.painPoint}
                                  </p>
                                  <p style={{ color: "var(--text-subtle)" }}>
                                    <span style={{ color: "var(--holos-info)" }}>Insight · </span>
                                    {story.nonObviousInsight}
                                  </p>
                                  <Show when={story.candidateAngles.length > 0}>
                                    <div class="holos-drawer__angles">
                                      <For each={story.candidateAngles}>
                                        {(a) => (
                                          <span
                                            class="holos-chip"
                                            style={{
                                              background: "var(--surface-base)",
                                              border: "1px solid var(--border-weak-base)",
                                            }}
                                          >
                                            <span style={{ color: "var(--holos-accent)" }}>{a.type}</span>:{" "}
                                            {a.titleSketch}
                                          </span>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </div>
                                <Show when={hasRadar}>
                                  <StoryRadar scores={story.scores} color={statusColor} height={140} />
                                </Show>
                              </div>
                              <Show when={!hasRadar && Object.keys(story.scores).length > 0}>
                                <div class="holos-drawer__scores">
                                  <For each={Object.entries(story.scores)}>
                                    {([k, v]) => (
                                      <span class="holos-meta">
                                        {k}: <span style={{ color: "var(--text-subtle)" }}>{v}</span>
                                      </span>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Section>
                </Show>

                <For each={rqgs()}>
                  {(rqg) => (
                    <Section title="Research Quality Gate" icon="shield">
                      <div class="holos-drawer__rqg">
                        <span
                          class="holos-drawer__rqg-badge"
                          style={{
                            background:
                              rqg.overall === "passed"
                                ? "rgba(52, 211, 153, 0.12)"
                                : rqg.overall === "failed" || rqg.overall === "invalid"
                                  ? "rgba(248, 113, 113, 0.12)"
                                  : "rgba(251, 191, 36, 0.12)",
                            color:
                              rqg.overall === "passed"
                                ? "var(--holos-success)"
                                : rqg.overall === "failed" || rqg.overall === "invalid"
                                  ? "var(--holos-danger)"
                                  : "var(--holos-warning)",
                            border: "1px solid currentColor",
                          }}
                        >
                          {rqg.overall.toUpperCase()}
                        </span>
                        <div class="holos-drawer__rqg-rings">
                          <div class="holos-drawer__rqg-ring">
                            <ProgressRing
                              value={rqg.killSetPassed}
                              max={Math.max(rqg.killSetTotal, 1)}
                              size={48}
                              strokeWidth={4}
                              color={
                                rqg.killSetPassed === rqg.killSetTotal ? "var(--holos-success)" : "var(--holos-danger)"
                              }
                              label={`${rqg.killSetPassed}/${rqg.killSetTotal}`}
                            />
                            <span class="holos-meta">KILL SET</span>
                          </div>
                          <div class="holos-drawer__rqg-ring">
                            <ProgressRing
                              value={rqg.sufficientSetPassed}
                              max={Math.max(rqg.sufficientSetTotal, 1)}
                              size={48}
                              strokeWidth={4}
                              color={
                                rqg.sufficientSetPassed === rqg.sufficientSetTotal
                                  ? "var(--holos-success)"
                                  : "var(--holos-warning)"
                              }
                              label={`${rqg.sufficientSetPassed}/${rqg.sufficientSetTotal}`}
                            />
                            <span class="holos-meta">SUFFICIENT</span>
                          </div>
                        </div>
                      </div>
                      <Show when={rqg.allowedNext.length > 0}>
                        <p class="holos-drawer__rqg-note" style={{ color: "var(--text-subtle)" }}>
                          <span style={{ color: "var(--holos-success)" }}>✓ Allowed: </span>
                          {rqg.allowedNext.join(", ")}
                        </p>
                      </Show>
                      <Show when={rqg.disallowedNext.length > 0}>
                        <p class="holos-drawer__rqg-note" style={{ color: "var(--text-subtle)" }}>
                          <span style={{ color: "var(--holos-danger)" }}>✗ Disallowed: </span>
                          {rqg.disallowedNext.join(", ")}
                        </p>
                      </Show>
                    </Section>
                  )}
                </For>

                <For each={diagnoses()}>
                  {(diag) => (
                    <Section title="Diagnosis Ladder" icon="network">
                      <p style={{ color: "var(--text-subtle)" }}>{diag.conclusion}</p>
                      <Show when={diag.pivotRoute}>
                        <p class="holos-drawer__pivot-route">
                          <Icon name="undo" size={11} color="var(--holos-warning)" strokeWidth={2.2} />
                          Pivot route → {diag.pivotRoute}
                        </p>
                      </Show>
                      <DiagnosisLadder levels={diag.levels} />
                    </Section>
                  )}
                </For>

                <Show when={p().pivotTargets.length > 0}>
                  <Section title="Pivot Targets" icon="gitBranch" count={p().pivotTargets.length}>
                    <div class="holos-drawer__pivot-targets">
                      <For each={p().pivotTargets}>
                        {(pt) => (
                          <div
                            class="holos-drawer__pivot-target"
                            style={{
                              background: "rgba(251, 191, 36, 0.05)",
                              border: "1px solid rgba(251, 191, 36, 0.18)",
                            }}
                          >
                            <Icon name="undo" size={13} color="var(--holos-warning)" strokeWidth={2.2} />
                            <span style={{ color: "var(--text-strong)" }}>{pt.to}</span>
                            <span style={{ color: "var(--text-subtle)" }}>{pt.trigger}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Section>
                </Show>

                <Show when={p().checkpoints.length > 0}>
                  <Section title="Human Checkpoints" icon="flag" count={p().checkpoints.length}>
                    <div class="holos-drawer__checkpoints">
                      <For each={p().checkpoints}>{(chk) => <CheckpointCard chk={chk} />}</For>
                    </div>
                  </Section>
                </Show>

                <Show when={p().contextRefreshedAt}>
                  <Section title="Context Refresh" icon="spark">
                    <p class="holos-drawer__context-refresh">
                      <Icon name="refresh" size={11} color="var(--holos-info)" strokeWidth={2.2} />
                      Last refreshed:{" "}
                      <span style={{ color: "var(--text-strong)" }}>
                        {new Date(p().contextRefreshedAt ?? "").toLocaleString()}
                      </span>
                    </p>
                  </Section>
                </Show>

                <Section title="Entities" icon="package" count={phaseEntities().length}>
                  <Show
                    when={phaseEntities().length > 0}
                    fallback={
                      <div class="holos-drawer__empty">
                        <Icon name="alert" size={12} color="var(--text-weaker)" />
                        No entities in this phase yet
                      </div>
                    }
                  >
                    <div class="holos-drawer__entities">
                      <For each={phaseEntities()}>
                        {(ent) => (
                          <div
                            class="holos-drawer__entity"
                            style={{ background: "var(--surface-inset-base)", border: "1px solid var(--border-base)" }}
                          >
                            <div class="holos-drawer__entity-main">
                              <span style={{ color: "var(--text-strong)" }}>{ent.title}</span>
                              <Show when={ent.summary}>
                                <span style={{ color: "var(--text-subtle)" }}>{ent.summary}</span>
                              </Show>
                            </div>
                            <div class="holos-drawer__entity-side">
                              <span class="holos-meta">{ent.kind}</span>
                              <StatusBadge status={ent.status} size="sm" />
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Section>

                <Section title="Phase Timeline" icon="history">
                  <TimelineFeed events={props.data.timeline} phaseFilter={p().name} maxHeight={320} />
                </Section>

                <div class="holos-drawer__footer">
                  <span class="holos-meta">
                    <Icon name="list" size={11} color="var(--text-weaker)" />
                    Press <span class="holos-kbd">esc</span> to close
                  </span>
                  <span class="holos-meta">monitor-board v2.1</span>
                </div>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
