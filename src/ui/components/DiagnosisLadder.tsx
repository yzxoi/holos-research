import { For, Show } from "solid-js";
import Icon, { type IconName } from "./icons";

export interface DiagnosisLevel {
  level: string;
  name: string;
  status: "pass" | "fail" | "skip" | "warning" | "pending";
  finding?: string;
}

interface DiagnosisLadderProps {
  levels: DiagnosisLevel[];
}

const STATUS_CONFIG: Record<DiagnosisLevel["status"], { color: string; icon: IconName; label: string }> = {
  pass: { color: "var(--holos-success)", icon: "checkCircle", label: "PASS" },
  fail: { color: "var(--holos-danger)", icon: "xCircle", label: "FAIL" },
  skip: { color: "var(--text-subtle)", icon: "minusCircle", label: "SKIP" },
  warning: { color: "var(--holos-warning)", icon: "circle", label: "WARN" },
  pending: { color: "var(--text-subtle)", icon: "circle", label: "PENDING" },
};

export default function DiagnosisLadder({ levels }: DiagnosisLadderProps) {
  if (!levels.length) return null;
  return (
    <div class="holos-ladder">
      <div class="holos-ladder__row">
        <div class="holos-ladder__rail" />
        <For each={levels}>
          {(lv) => {
            const cfg = STATUS_CONFIG[lv.status];
            return (
              <div class="holos-ladder__step">
                <div
                  class="holos-ladder__node"
                  style={{
                    border: `1px solid ${cfg.color === "var(--text-subtle)" ? "var(--border-base)" : cfg.color}`,
                  }}
                >
                  <Icon name={cfg.icon} size={14} color={cfg.color} />
                </div>
                <span class="holos-ladder__level" style={{ color: cfg.color }}>
                  {lv.level}
                </span>
                <span class="holos-ladder__name" title={lv.name}>
                  {lv.name}
                </span>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={levels.some((lv) => lv.finding)}>
        <div class="holos-ladder__findings">
          <For each={levels.filter((lv) => lv.finding)}>
            {(lv) => {
              const cfg = STATUS_CONFIG[lv.status];
              return (
                <div class="holos-ladder__finding">
                  <span class="holos-ladder__finding-level" style={{ color: cfg.color }}>
                    {lv.level}
                  </span>
                  <span>{lv.finding}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
