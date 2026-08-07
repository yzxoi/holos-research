import type { EntityKind, PhaseName } from "./types";

/** Canonical phase ordering — single source of truth */
export const PHASE_ORDER: PhaseName[] = ["explore", "ground", "design", "realize", "experiment", "compose"];

/** Phase display names — single source of truth */
export const PHASE_DISPLAY_NAMES: Record<PhaseName, string> = {
  explore: "Explore",
  ground: "Ground",
  design: "Design",
  realize: "Realize",
  experiment: "Experiment",
  compose: "Compose",
};

/** Phase colors using CSS variables — single source of truth */
export const PHASE_COLORS: Record<PhaseName, string> = {
  explore: "var(--accent-primary)",
  ground: "var(--accent-info)",
  design: "var(--accent-warn)",
  realize: "var(--accent-warn)",
  experiment: "var(--accent-success)",
  compose: "var(--accent-cyan)",
};

/** Phase colors as hex fallbacks (for SVG rendering where CSS vars aren't resolved) */
export const PHASE_COLORS_HEX: Record<PhaseName, string> = {
  explore: "#5aa6f0",
  ground: "#a78bfa",
  design: "#ec4899",
  realize: "#fbbf24",
  experiment: "#34d399",
  compose: "#2dd4bf",
};

/** Entity kind colors — single source of truth */
export const ENTITY_KIND_COLORS: Record<EntityKind, string> = {
  idea: "#5aa6f0",
  plan: "#a78bfa",
  experiment: "#34d399",
  claim: "#34d399",
  exhibit: "#2dd4bf",
  paper: "#5aa6f0",
  submission: "#ec4899",
};

export const PHASE_DESCRIPTIONS: Record<PhaseName, string> = {
  explore: "Discover and generate research ideas",
  ground: "Validate ideas against literature",
  design: "Plan experiments and methods",
  realize: "Implement code and protocols",
  experiment: "Run experiments and collect data",
  compose: "Write paper and prepare submission",
};

export const PHASE_KEY_QUESTIONS: Record<PhaseName, string> = {
  explore: "哪些方向值得看？",
  ground: "这个 idea 应该讲成什么贡献？",
  design: "机制是否值得实现？",
  realize: "代码和实验定义是否真实可用？",
  experiment: "证据是否可信，失败原因是什么？",
  compose: "paper 如何诚实成文？",
};

export const PHASE_PROMOTE_CRITERIA: Record<PhaseName, string[]> = {
  explore: ["Top-K 候选有明确 story potential", "用户确认进入 ground"],
  ground: ["至少 1 个 paper path 兼具 novelty/story/feasibility", "用户确认"],
  design: ["Design rubric 过阈值", "成功/失败标准清楚"],
  realize: ["Sanity/smoke/code review 通过", "实验已注册"],
  experiment: ["结果足以支撑 paper ambition", "或失败已被归因并路由"],
  compose: ["所有 paper-visible result 都有 exp refs", "consistency/overclaim check 通过"],
};

export const PHASE_PIVOT_TARGETS: Record<PhaseName, Array<{ to: PhaseName; trigger: string }>> = {
  explore: [],
  ground: [{ to: "explore", trigger: "所有候选被 scooped 或 anchor/story 方向错误" }],
  design: [{ to: "ground", trigger: "贡献边界不清，需要重定位 story" }],
  realize: [{ to: "design", trigger: "算法定义不充分，sanity 无法解释" }],
  experiment: [
    { to: "realize", trigger: "L1-L5 诊断指向实现/eval/数据 bug" },
    { to: "design", trigger: "L1-L5 通过但机制无法产生足够信号" },
    { to: "ground", trigger: "方法有弱信号，但原 paper story/benchmark 不对" },
  ],
  compose: [
    { to: "experiment", trigger: "overclaim 或证据缺口" },
    { to: "ground", trigger: "story 不再成立" },
  ],
};

export const STATIC_PIVOT_EDGES: Array<{ from: PhaseName; to: PhaseName; label: string; trigger: string }> = [
  { from: "ground", to: "explore", label: "pivot", trigger: "scooped / anchor wrong" },
  { from: "design", to: "ground", label: "pivot", trigger: "contribution unclear" },
  { from: "realize", to: "design", label: "pivot", trigger: "underspecified / sanity fail" },
  { from: "experiment", to: "realize", label: "checkpoint", trigger: "implementation bug" },
  { from: "experiment", to: "design", label: "pivot", trigger: "method signal absent" },
  { from: "experiment", to: "ground", label: "pivot", trigger: "story/benchmark mismatch" },
  { from: "compose", to: "experiment", label: "pivot", trigger: "evidence gap" },
  { from: "compose", to: "ground", label: "pivot", trigger: "story broken" },
];
