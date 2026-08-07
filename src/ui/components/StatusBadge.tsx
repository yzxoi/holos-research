import type { EntityStatus, PhaseStatus } from "../types";
import Icon, { type IconName } from "./icons";

interface StatusBadgeProps {
  status: PhaseStatus | EntityStatus;
  size?: "sm" | "md";
}

interface BadgeConfig {
  label: string;
  color: string;
  icon: IconName;
  pulse?: boolean;
}

const CONFIG: Record<string, BadgeConfig> = {
  // Active/progressing
  active: { label: "ACTIVE", color: "var(--holos-accent)", icon: "activity", pulse: true },
  exploring: { label: "EXPLORING", color: "var(--holos-accent)", icon: "activity", pulse: true },
  grounding: { label: "GROUNDING", color: "var(--holos-accent)", icon: "activity", pulse: true },
  selected: { label: "SELECTED", color: "var(--holos-accent)", icon: "activity" },
  registered: { label: "REGISTERED", color: "var(--holos-accent)", icon: "activity" },
  scheduled: { label: "SCHEDULED", color: "var(--holos-info)", icon: "clock" },
  running: { label: "RUNNING", color: "var(--holos-info)", icon: "activity", pulse: true },
  drafting: { label: "DRAFTING", color: "var(--holos-info)", icon: "file" },
  revising: { label: "REVISING", color: "var(--holos-info)", icon: "file" },
  outlined: { label: "OUTLINED", color: "var(--holos-info)", icon: "file" },
  preparing: { label: "PREPARING", color: "var(--holos-info)", icon: "clock" },

  // Draft/pending
  draft: { label: "DRAFT", color: "var(--text-subtle)", icon: "file" },
  proposed: { label: "PROPOSED", color: "var(--text-subtle)", icon: "file" },
  candidate: { label: "CANDIDATE", color: "var(--text-subtle)", icon: "file" },
  pending: { label: "PENDING", color: "var(--text-subtle)", icon: "clock" },

  // Completed/success
  completed: { label: "DONE", color: "var(--holos-success)", icon: "checkCircle" },
  approved: { label: "APPROVED", color: "var(--holos-success)", icon: "checkCircle" },
  ready: { label: "READY", color: "var(--holos-success)", icon: "checkCircle" },
  verified: { label: "VERIFIED", color: "var(--holos-success)", icon: "checkCircle" },
  final: { label: "FINAL", color: "var(--holos-success)", icon: "checkCircle" },
  frozen: { label: "FROZEN", color: "var(--holos-success)", icon: "pause" },
  qualified: { label: "QUALIFIED", color: "var(--holos-success)", icon: "checkCircle" },
  supported: { label: "SUPPORTED", color: "var(--holos-success)", icon: "checkCircle" },
  accepted: { label: "ACCEPTED", color: "var(--holos-success)", icon: "checkCircle" },
  closed: { label: "CLOSED", color: "var(--holos-success)", icon: "pause" },

  // Submitted/under review
  submitted: { label: "SUBMITTED", color: "var(--holos-warning)", icon: "clock" },
  under_review: { label: "REVIEW", color: "var(--holos-warning)", icon: "clock" },
  rebuttal: { label: "REBUTTAL", color: "var(--holos-warning)", icon: "clock" },
  revision_requested: { label: "REV. REQ.", color: "var(--holos-warning)", icon: "clock" },
  resubmitted: { label: "RESUBMITTED", color: "var(--holos-warning)", icon: "clock" },

  // Blocked/warning
  blocked: { label: "BLOCKED", color: "var(--holos-danger)", icon: "ban" },
  parked: { label: "PARKED", color: "var(--holos-warning)", icon: "pause" },
  weak: { label: "WEAK", color: "var(--holos-warning)", icon: "alert" },

  // Failed/error
  failed: { label: "FAILED", color: "var(--holos-danger)", icon: "xCircle" },
  rejected: { label: "REJECTED", color: "var(--holos-danger)", icon: "xCircle" },
  invalidated: { label: "INVALIDATED", color: "var(--holos-danger)", icon: "xCircle" },
  retracted: { label: "RETRACTED", color: "var(--holos-danger)", icon: "xCircle" },
  dropped: { label: "DROPPED", color: "var(--holos-danger)", icon: "xCircle" },

  // Archived/superseded
  archived: { label: "ARCHIVED", color: "var(--text-subtle)", icon: "pause" },
  superseded: { label: "SUPERSEDED", color: "var(--text-subtle)", icon: "pause" },
  stopped: { label: "STOPPED", color: "var(--text-subtle)", icon: "pause" },

  // Fallback
  unknown: { label: "UNKNOWN", color: "var(--text-subtle)", icon: "help" },
};

const UNKNOWN_CONFIG: BadgeConfig = {
  label: "UNKNOWN",
  color: "var(--text-subtle)",
  icon: "help",
};

export default function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const c: BadgeConfig = CONFIG[status] ?? UNKNOWN_CONFIG;
  const iconSize = size === "sm" ? 9 : 10;

  return (
    <span class={`holos-badge ${size === "sm" ? "holos-badge--sm" : ""}`} style={{ color: c.color }}>
      <span class={c.pulse ? "holos-badge__pulse" : ""} style={{ display: "inline-flex" }}>
        <Icon name={c.icon} size={iconSize} color={c.color} strokeWidth={2.4} />
      </span>
      {c.label}
    </span>
  );
}
