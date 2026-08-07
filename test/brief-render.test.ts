import { describe, expect, test } from "bun:test";
import type { PhaseRun, StateYaml } from "../src/schema";
import { PhaseRun as PhaseRunSchema } from "../src/schema";
import {
  renderActiveRun,
  renderBlockedOn,
  renderCompletedRun,
  renderPendingCheckpoint,
  renderSummary,
  type BriefItem,
} from "../src/brief-render";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRun(overrides: Partial<PhaseRun> = {}): PhaseRun {
  const now = "2026-01-01T00:00:00Z";
  return PhaseRunSchema.parse({
    id: "run_abc123def456",
    phase: "explore",
    status: "active",
    created: now,
    updated: "2026-01-01T01:00:00Z",
    inner_loop: {
      state: "attempt",
      created: now,
      updated: "2026-01-01T00:30:00Z",
      round: 1,
      attempts: 2,
      stagnation_rounds: 0,
      budget: { max_attempts: 6, max_stagnation: 2, max_escalations: 2 },
    },
    human_checkpoints: [],
    artifacts: {},
    ...overrides,
  });
}

function makeState(overrides: Partial<StateYaml> = {}): StateYaml {
  return {
    project: "test-project",
    schema_version: 2,
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T01:00:00Z",
    config: { participation_mode: "collaborative" },
    counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
    focus: {
      since: "2026-01-01T00:00:00Z",
      phase: "explore",
    },
    ...overrides,
  } as StateYaml;
}

// ── renderActiveRun ───────────────────────────────────────────────────────────

describe("renderActiveRun", () => {
  test("renders basic active run with inner loop", () => {
    const item = renderActiveRun(makeRun());
    expect(item.text).toContain("Working in Explore phase");
    expect(item.text).toContain("attempt 2/6");
    expect(item.text).toContain("round 1");
    expect(item.phase).toBe("explore");
    expect(item.severity).toBe("active");
    expect(item.since).toBe("2026-01-01T00:00:00Z");
  });

  test("renders without inner loop data", () => {
    const run = makeRun();
    const item = renderActiveRun({ ...run, inner_loop: undefined as unknown as PhaseRun["inner_loop"] });
    expect(item.text).toContain("no inner loop data");
    expect(item.text).toContain("run_abc123de");
    expect(item.severity).toBe("active");
  });

  test("includes progress metric when both current and previous are set", () => {
    const run = makeRun({
      inner_loop: {
        ...makeRun().inner_loop,
        progress_metric: { name: "novelty", previous: 3, current: 5 },
      },
    });
    const item = renderActiveRun(run);
    expect(item.text).toContain("novelty: 5 (up from 3)");
  });

  test("progress metric shows down direction", () => {
    const run = makeRun({
      inner_loop: {
        ...makeRun().inner_loop,
        progress_metric: { name: "error_rate", previous: 5, current: 3 },
      },
    });
    const item = renderActiveRun(run);
    expect(item.text).toContain("error_rate: 3 (down from 5)");
  });

  test("progress metric skipped when current/previous undefined", () => {
    const run = makeRun({
      inner_loop: {
        ...makeRun().inner_loop,
        progress_metric: { name: "novelty" },
      },
    });
    const item = renderActiveRun(run);
    expect(item.text).not.toContain("novelty:");
  });

  test("includes run summary when present", () => {
    const run = makeRun({ summary: "Found promising direction" });
    const item = renderActiveRun(run);
    expect(item.text).toContain("Found promising direction");
  });

  test("uses default max_attempts when budget missing", () => {
    const base = makeRun();
    const run = makeRun({
      inner_loop: {
        ...base.inner_loop,
        budget: undefined,
        attempts: 3,
      },
    });
    const item = renderActiveRun(run);
    expect(item.text).toContain("attempt 3/6");
  });

  test("uses default attempts/round when zero", () => {
    const run = makeRun({
      inner_loop: {
        ...makeRun().inner_loop,
        attempts: 0,
        round: 1,
      },
    });
    const item = renderActiveRun(run);
    expect(item.text).toContain("attempt 0/6");
    expect(item.text).toContain("round 1");
  });

  test("maps inner loop states to correct verbs", () => {
    const cases: [PhaseRun["inner_loop"]["state"], string][] = [
      ["evaluate", "Evaluating"],
      ["decide", "Deciding next step"],
      ["aborted", "Aborted"],
    ];
    for (const [state, verb] of cases) {
      const run = makeRun({ inner_loop: { ...makeRun().inner_loop, state } });
      expect(renderActiveRun(run).text).toContain(verb);
    }
  });

  test("uses 'Working' for unknown inner loop state", () => {
    const run = makeRun({ inner_loop: { ...makeRun().inner_loop, state: "promoted" } });
    const item = renderActiveRun(run);
    expect(item.text).toContain("Working in Explore phase");
  });

  test("renders each phase with correct display name", () => {
    const cases: [PhaseRun["phase"], string][] = [
      ["ground", "Ground"],
      ["design", "Design"],
      ["realize", "Realize"],
      ["experiment", "Experiment"],
      ["compose", "Compose"],
    ];
    for (const [phase, display] of cases) {
      const run = makeRun({ phase });
      expect(renderActiveRun(run).text).toContain(display);
    }
  });
});

// ── renderBlockedOn ───────────────────────────────────────────────────────────

describe("renderBlockedOn", () => {
  test("renders blocked item with focus phase", () => {
    const item = renderBlockedOn("waiting for human approval", makeState());
    expect(item.text).toBe("Blocked in Explore phase: waiting for human approval");
    expect(item.phase).toBe("explore");
    expect(item.severity).toBe("warning");
    expect(item.since).toBe("2026-01-01T00:00:00Z");
  });

  test("falls back to 'unknown' phase when no focus", () => {
    const state = makeState({ focus: undefined });
    const item = renderBlockedOn("infra failure", state);
    expect(item.text).toBe("Blocked in unknown phase: infra failure");
    expect(item.phase).toBe("unknown");
  });

  test("since is undefined when focus has no since", () => {
    const state = makeState({ focus: { since: undefined as unknown as string, phase: "design" } });
    const item = renderBlockedOn("blocked reason", state);
    expect(item.since).toBeUndefined();
  });
});

// ── renderPendingCheckpoint ───────────────────────────────────────────────────

describe("renderPendingCheckpoint", () => {
  test("renders checkpoint without question", () => {
    const item = renderPendingCheckpoint(makeRun(), "scope_check");
    expect(item.text).toBe("Awaiting human decision in Explore phase (scope check)");
    expect(item.phase).toBe("explore");
    expect(item.severity).toBe("human");
    expect(item.since).toBe("2026-01-01T01:00:00Z");
  });

  test("renders checkpoint with question", () => {
    const item = renderPendingCheckpoint(makeRun(), "scope_check", "Should we pivot?");
    expect(item.text).toBe(
      "Awaiting human decision in Explore phase (scope check): Should we pivot?",
    );
  });

  test("replaces underscores in kind with spaces", () => {
    const item = renderPendingCheckpoint(makeRun(), "quality_gate_review");
    expect(item.text).toContain("quality gate review");
    expect(item.text).not.toContain("quality_gate_review");
  });

  test("uses run.updated for since", () => {
    const item = renderPendingCheckpoint(makeRun(), "scope_check");
    expect(item.since).toBe("2026-01-01T01:00:00Z");
  });
});

// ── renderCompletedRun ────────────────────────────────────────────────────────

describe("renderCompletedRun", () => {
  test("renders promoted run with next phase", () => {
    const run = makeRun({ status: "promoted" });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Completed Explore phase, promoted to Ground");
    expect(item.severity).toBe("promoted");
    expect(item.since).toBe(run.updated);
  });

  test("renders promoted run for last phase as 'next phase'", () => {
    const run = makeRun({ phase: "compose", status: "promoted" });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Completed Compose phase, promoted to next phase");
  });

  test("renders promoted run with summary", () => {
    const run = makeRun({ status: "promoted", summary: "Strong results" });
    const item = renderCompletedRun(run);
    expect(item.text).toContain("Strong results");
  });

  test("renders pivoted run with pivot data and rationale", () => {
    const run = makeRun({
      status: "pivoted",
      pivot: {
        from: "explore",
        to: "ground",
        category: "method_failure",
        rationale: "No viable method found",
        evidence_refs: [],
        alternatives_considered: [],
      },
    });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Pivoted from Explore to Ground (method failure): No viable method found");
    expect(item.severity).toBe("pivoted");
  });

  test("renders pivoted run with underscore category as spaces", () => {
    const run = makeRun({
      status: "pivoted",
      pivot: {
        from: "design",
        to: "explore",
        category: "scope_shift",
        rationale: "Requirements changed",
        evidence_refs: [],
        alternatives_considered: [],
      },
    });
    const item = renderCompletedRun(run);
    expect(item.text).toContain("scope shift");
    expect(item.text).not.toContain("scope_shift");
  });

  test("renders pivoted run without pivot data", () => {
    const run = makeRun({ status: "pivoted" });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Pivoted from Explore phase (details unavailable)");
    expect(item.severity).toBe("pivoted");
  });

  test("renders pivoted run without rationale omits colon suffix", () => {
    const run = makeRun({
      status: "pivoted",
      pivot: {
        from: "explore",
        to: "ground",
        category: "evidence_gap",
        rationale: "",
        evidence_refs: [],
        alternatives_considered: [],
      },
    });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Pivoted from Explore to Ground (evidence gap)");
  });

  test("renders aborted run without summary", () => {
    const run = makeRun({ status: "aborted" });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Aborted Explore phase");
    expect(item.severity).toBe("aborted");
  });

  test("renders aborted run with summary", () => {
    const run = makeRun({ status: "aborted", summary: "Budget exhausted" });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Aborted Explore phase: Budget exhausted");
  });

  test("fallback for unknown terminal status", () => {
    const run = makeRun({ status: "blocked" });
    const item = renderCompletedRun(run);
    expect(item.text).toBe("Finished Explore phase (blocked)");
    expect(item.severity).toBe("promoted");
  });
});

// ── renderSummary ─────────────────────────────────────────────────────────────

describe("renderSummary", () => {
  test("renders not-started summary when no phase and no items", () => {
    expect(renderSummary([], [], null, null)).toBe("Project has not started yet.");
  });

  test("renders current phase without items", () => {
    expect(renderSummary([], [], "explore", null)).toBe("Project is in Explore phase.");
  });

  test("renders single promoted phase", () => {
    const done: BriefItem[] = [
      { text: "done1", phase: "explore", severity: "promoted", since: "a" },
    ];
    const summary = renderSummary([], done, "ground", null);
    expect(summary).toContain("1 phase completed");
    expect(summary).toContain("Project is in Ground phase");
  });

  test("pluralizes phases when more than one promoted", () => {
    const done: BriefItem[] = [
      { text: "d1", phase: "explore", severity: "promoted", since: "a" },
      { text: "d2", phase: "ground", severity: "promoted", since: "b" },
    ];
    const summary = renderSummary([], done, "design", null);
    expect(summary).toContain("2 phases completed");
  });

  test("includes pivoted count", () => {
    const done: BriefItem[] = [
      { text: "d1", phase: "explore", severity: "pivoted", since: "a" },
    ];
    const summary = renderSummary([], done, "design", null);
    expect(summary).toContain("1 pivot");
  });

  test("pluralizes pivots", () => {
    const done: BriefItem[] = [
      { text: "d1", phase: "explore", severity: "pivoted", since: "a" },
      { text: "d2", phase: "ground", severity: "pivoted", since: "b" },
    ];
    const summary = renderSummary([], done, "design", null);
    expect(summary).toContain("2 pivots");
  });

  test("includes aborted count", () => {
    const done: BriefItem[] = [
      { text: "d1", phase: "explore", severity: "aborted", since: "a" },
    ];
    const summary = renderSummary([], done, "design", null);
    expect(summary).toContain("1 aborted");
  });

  test("shows blocked status when warning item present", () => {
    const doing: BriefItem[] = [
      { text: "blocked", phase: "explore", severity: "warning", since: "a" },
    ];
    const summary = renderSummary(doing, [], "explore", null);
    expect(summary).toContain("currently blocked");
  });

  test("shows awaiting human input when human severity present", () => {
    const doing: BriefItem[] = [
      { text: "checkpoint", phase: "explore", severity: "human", since: "a" },
    ];
    const summary = renderSummary(doing, [], "explore", null);
    expect(summary).toContain("awaiting human input");
  });

  test("shows currently active for active items", () => {
    const doing: BriefItem[] = [
      { text: "running", phase: "explore", severity: "active", since: "a" },
    ];
    const summary = renderSummary(doing, [], "explore", null);
    expect(summary).toContain("currently active");
  });

  test("blocked takes priority over human and active", () => {
    const doing: BriefItem[] = [
      { text: "active", phase: "explore", severity: "active", since: "a" },
      { text: "human", phase: "explore", severity: "human", since: "b" },
      { text: "blocked", phase: "ground", severity: "warning", since: "c" },
    ];
    expect(renderSummary(doing, [], "explore", null)).toContain("currently blocked");
  });

  test("human takes priority over active", () => {
    const doing: BriefItem[] = [
      { text: "active", phase: "explore", severity: "active", since: "a" },
      { text: "human", phase: "explore", severity: "human", since: "b" },
    ];
    expect(renderSummary(doing, [], "explore", null)).toContain("awaiting human input");
  });

  test("full summary combines all segments with periods", () => {
    const doing: BriefItem[] = [
      { text: "active", phase: "design", severity: "active", since: "a" },
    ];
    const done: BriefItem[] = [
      { text: "d1", phase: "explore", severity: "promoted", since: "b" },
      { text: "d2", phase: "ground", severity: "pivoted", since: "c" },
      { text: "d3", phase: "realize", severity: "aborted", since: "d" },
    ];
    const summary = renderSummary(doing, done, "design", null);
    expect(summary).toContain("Project is in Design phase");
    expect(summary).toContain("1 phase completed");
    expect(summary).toContain("1 pivot");
    expect(summary).toContain("1 aborted");
    expect(summary).toContain("currently active");
    expect(summary.endsWith(".")).toBe(true);
  });

  test("empty doing and done with phase only", () => {
    const summary = renderSummary([], [], "realize", null);
    expect(summary).toBe("Project is in Realize phase.");
  });
});
