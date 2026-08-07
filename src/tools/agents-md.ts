/**
 * Generate AGENTS.md content for a research project.
 *
 * This file is placed at the project root and auto-loaded by Synergy on every
 * session start (including after context compaction). It serves two purposes:
 *
 * 1. Static rules: behavioral norms that NEVER change (code discipline,
 *    directory structure, tool usage, research methodology).
 * 2. Dynamic state: current phase, recent activity, next steps — updated
 *    by research_state(action="brief").
 *
 * The static section is generated once by research_init.
 * The dynamic section is regenerated on every brief call.
 */

import { log } from "../log";
import type { StateYaml, TimelineEvent } from "../schema";

// ────────────────────────────────────────────────────────────────────────────
// Static section — behavioral norms that survive context compaction
// ────────────────────────────────────────────────────────────────────────────

const STATIC_RULES = `## Critical Operating Rules (MUST follow every session)

### Session Startup Checklist

Every time you start working (including after context compaction):

1. Run \`research_state(action="read")\` to confirm current phase and progress
2. Load the appropriate phase skill: \`skill(name="research")\` or the specific phase skill
3. Check recent timeline: \`research_timeline(action="read", last=10)\`
4. If experiments are running: \`inspire_jobs(status="running")\` to check status
5. Run \`research_state(action="overview")\` for full pipeline health check

### Use Tools and Skills Constantly

**You MUST actively use research tools** — they are not optional decorations:

- \`research_state\` — read/update project state on EVERY session
- \`research_experiment\` — track ALL experiment lifecycle changes (register → schedule → start → complete/fail)
- \`research_wiki\` — ingest papers, register gaps, link relationships whenever you discover relevant work
- \`research_timeline\` — record insights, milestones, decisions
- \`research_claim\` — extract claims from completed experiments
- \`skill(name="...")\` — load the phase-appropriate skill for structured guidance

**If you find yourself working without calling research tools, STOP and course-correct.** The tools are the project's memory — without them, work becomes untracked and unreproducible.

### Workflow Triggers (When → Do What)

| Trigger | Required Action |
|---------|----------------|
| Experiment status changes | \`research_experiment(schedule/start/complete/fail)\` immediately |
| Experiment completes | Analyze results, compare with baseline, write experiment .md summary |
| ≥3 experiments analyzed | Consider extracting claims: \`research_claim(create)\` |
| Discover relevant paper | \`research_wiki(ingest_paper)\` + fill the .md knowledge page |
| Important decision made | \`research_timeline(append_free_event, event_type="decision")\` |
| Key insight discovered | \`research_timeline(append_free_event, event_type="insight")\` |
| Session ending | \`research_state(action="brief")\` to update this file |
| Worked >2 hours continuously | \`research_state(action="overview")\` to check pipeline health |
| Code changes complete | \`git add && git commit\` immediately |
| Before submitting experiment | Verify \`git status --porcelain\` is empty |

### Git Discipline (Non-Negotiable)

- **Commit after every logical unit of work** — do NOT accumulate changes
- **Clean working tree before experiments** — \`git status --porcelain\` must be empty
- **Conventional commit messages**: \`feat(module): description\`, \`fix(module): description\`, \`refactor(module): ...\`
- **NEVER keep v1/v2/v3 files** — use git history for versioning
- **Delete dead code immediately** — or move to \`archive/\` if needed for reference
- **No debug prints, temp files, or commented-out code** in commits

### Code Quality Standards

- **Clear naming**: variables, functions, files, classes — all must be self-explanatory
  - Bad: \`d\`, \`tmp\`, \`data2\`, \`process_stuff\`, \`run_v3.py\`
  - Good: \`learning_rate\`, \`batch_metrics\`, \`token_embeddings\`, \`compute_attention_scores\`, \`train_baseline.py\`
- **Single responsibility**: each function does ONE thing, each file has ONE purpose
- **No redundancy**: extract shared logic into helpers, never copy-paste code blocks
- **Readable over clever**: prefer explicit, obvious code over tricky one-liners
- **After writing code, use inspector subagent** to self-check for bugs, dead code, and quality issues
- **TDD when adding features**: write the test first → confirm it fails → implement → confirm it passes

### Python Environment

- **Always use project-local venv** (\`uv venv\` or \`python -m venv .venv\`) — NEVER install to global Python
- **Maintain \`pyproject.toml\`** with all dependencies — update it when you add packages
- **Pin versions** in a lock file for reproducibility
- **Activate before running**: \`source .venv/bin/activate\`

### Directory Structure

\`\`\`
{package}/     — Core source code (pip install -e .)
scripts/       — Entry point scripts and CLI tools
configs/       — Experiment config YAML files
data/          — Data files (gitignored, never committed)
results/       — Experiment outputs (gitignored)
logs/          — Log files (gitignored)
docs/          — Documentation, surveys, design notes
papers/        — Reference PDFs (gitignored)
archive/       — Archived old code (kept for reference)
docker/        — Dockerfile and image configs
.research/     — Research state (managed by research tools)
\`\`\`

Rules:
- **Root directory stays clean**: only README.md, pyproject.toml, .gitignore, AGENTS.md
- **Documentation goes in \`docs/\`** — no loose .md files scattered in root
- **Data and results use subdirectories** — never \`results_v2/\`, \`results_v3/\`
- **Archive superseded code** in \`archive/\` — do not leave dead files around
- **.gitignore must cover**: data/, results/, logs/, papers/, checkpoints/, *.pt, *.pdf, .venv/

### Phase Boundaries (Non-Negotiable)

Each research phase has a strict scope. Crossing boundaries without advancing via \`research_state(action="advance")\` breaks pipeline integrity.

- **explore**: Survey + ideate ONLY. No method design, no code.
- **ground**: Position novelty ONLY. No method design, no code.
- **design**: Design method + experiment plan ONLY. No code, no training.
- **realize**: Write code + verify sanity/quality contracts ONLY. Sanity checks must be <5 min, single GPU, 1-2 batches. **NO training, NO compute_submit, NO inspire_submit, NO nohup training.** If you need to run training, the code is ready — advance to experiment phase first.
- **experiment**: Submit compute jobs + run full experiments ONLY after phase advance. \`compute_submit\` and \`inspire_submit\` are ONLY for this phase.
- **compose**: Write paper ONLY. No new experiments (supplements go through experiment-iterate).

**If you find yourself running training in realize phase, STOP and use \`research_state(action="advance", target_phase="experiment")\`.**

### Long-Running Tasks

- **Use \`nohup\` with log redirect**: \`nohup python train.py > logs/exp_name.log 2>&1 &\`
- **Set \`agenda_watch\`** for periodic status checks — NEVER use bash to poll/wait
- **Inspire platform tasks**: use \`inspire_submit\`, then \`agenda_watch\` to monitor
- **Always capture logs**: every experiment must have a log file in \`logs/\`

### Evidence, Not Experiments

You are not running experiments. You are producing evidence for a scientific claim that must survive adversarial review at a top venue. Every experiment must answer: "Would a skeptical reviewer accept this as proof?"

Evidence that fails this test:
- Results on synthetic or self-generated data instead of real benchmarks
- Results using a custom evaluator instead of the benchmark's official evaluator
- Results on a tiny subset (a few examples) instead of the full benchmark
- Results where the data, code, or evaluation cannot be independently reproduced
- Results from an environment that does not match the claim's context

These are prototypes, not evidence. Prototypes are useful for debugging pipelines. They are worthless for proving a contribution.

Every experiment has an authenticity level:
- \`prototype\` — synthetic data, homemade evaluator, toy subset. For debugging only. Cannot be marked complete. Cannot support claims.
- \`pilot\` — real data at reduced scale. For direction validation. Cannot support claims.
- \`evidence\` — full benchmark, official evaluator, complete scale. Can support claims.

Before submitting any experiment, verify:
1. Is the data real? (from an actual benchmark or dataset, not generated)
2. Is the evaluation real? (using the benchmark's official evaluator, not homemade)
3. Is the scale real? (full benchmark, not a toy subset)
4. Would a reviewer at the target venue accept this as valid evidence?

If any answer is no, register the experiment as \`prototype\` or \`pilot\`. Only \`evidence\`-grade experiments can support claims in the paper.

### Research Methodology

- **Design before execute** — plan experiments before running them, validate method before implementing
- **Record failures** — failed experiments are valuable; always log failure_reason and lessons learned
- **Check anchor drift regularly** — is current work still aligned with the research direction?
- **Use subagents for review**: \`critic\` for adversarial evaluation, \`methodologist\` for design feedback
- **Proactively ingest knowledge to wiki** — don't ask "should I store this?", just do it
- **Periodically analyze timeline** — look for patterns, stalled items, neglected directions

### Complete Experiment Design (Method Is Only Half the Work)

A method is only as strong as the experiments that prove it. When designing a method, simultaneously design ALL supporting dimensions. None is optional. None can be deferred.

**Five co-dependent dimensions:**
1. Method — algorithm, architecture, mechanism
2. Benchmark & Dataset — what to test on, what data to use
3. Baselines — what to compare against, are comparisons fair
4. Evaluation — how to measure success, metrics, statistical rigor
5. Infrastructure — reproducibility, efficiency, failure recovery

These dimensions constrain each other. A method designed without knowing the benchmark may solve the wrong problem. A benchmark chosen without evaluation metrics may not capture the claim. Baselines without infrastructure planning may not be reproducible.

During method-design, load the relevant reference files for each dimension:
- \`references/benchmark-design.md\` — benchmark selection and evaluation
- \`references/dataset-design.md\` — data collection, preprocessing, splits
- \`references/baseline-design.md\` — baseline selection and fairness
- \`references/evaluation-design.md\` — metrics, statistics, result presentation
- \`references/training-design.md\` — training recipes and infrastructure
- \`references/experiment-efficiency.md\` — parallelization, monitoring, failure recovery

Before presenting any method proposal, verify all five dimensions are concretely addressed. If any dimension is vague, the proposal is not ready.

### Research Integrity (Dual-Gate System)

Every experiment passes through TWO independent gates:

**Gate 1 — Code Gate (inspector subagent)**
Trigger: after writing or modifying experiment code, before git commit.
- Dispatch \`inspector\` subagent to audit code quality
- Checks: readability, naming clarity, dead code, project organization, no v1/v2/v3 files, no redundancy, clean imports
- Fix ALL issues before proceeding. Re-run inspector until clean.

**Gate 2 — Design Gate (red-lines + auditor subagent)**
Trigger: before experiment registration AND after experiment completion.
- Declare applicable red-lines at registration: \`research_experiment(register, redlines=["R1_metric_immutability", ...])\`
- Dispatch \`auditor\` subagent to independently verify each red-line
- Red-lines (R1-R7):
  - R1: Metric Immutability — eval metrics fixed at registration, never changed after seeing results
  - R2: Eval Integrity — eval code changes trigger full re-run of ALL compared methods
  - R3: No Data Leakage — test data never influences training or hyperparameter selection
  - R4: Honest Reporting — all metrics reported (mean±std across seeds), no cherry-picking
  - R5: Dataset Integrity — fixed train/val/test splits, identical for all compared methods
  - R6: Reproducibility — code, configs, seeds committed to git before experiment submission
  - R7: Domain Constraints — domain-specific constraints declared at registration and verified
- Update red-line status after auditor check: \`research_experiment(action="update", id="exp_XXX", redline_status={R1: "passed", ...})\`
- Experiment CANNOT be marked \`complete\` until all declared red-lines pass
- Claim CANNOT be promoted to \`supported\` if any evidence experiment has red-line violations

### Research Trail Integrity (Append-Only)

- **.md files are APPEND-ONLY** — add new sections with timestamps, NEVER delete previous content
- Use the \`content\` parameter on create actions to write initial analysis (replaces empty template)
- Use the \`notes\` parameter on status-change actions to append analysis (auto-timestamped)
- Use the \`review_body\` parameter on review actions for full reviewer feedback (saved as separate .review.NNN.md)
- If you need to correct earlier content, add a new dated "## Correction" section — don't edit the original
- **Every entity MUST specify its lineage**: idea→plan→experiment→claim→exhibit→paper
  - \`research_plan(create, idea="idea_003")\`
  - \`research_experiment(register, plan="plan_002", idea="idea_003")\`
  - \`research_claim(create, evidence=[{ref: "exp_007", ...}])\`
- The tool will warn you if lineage is missing — fix it immediately

`;

// ────────────────────────────────────────────────────────────────────────────
// Dynamic section — updated by research_state(action="brief")
// ────────────────────────────────────────────────────────────────────────────

const DYNAMIC_MARKER_START = "<!-- DYNAMIC_STATE_START -->";
const DYNAMIC_MARKER_END = "<!-- DYNAMIC_STATE_END -->";

export function generateDynamicSection(state: StateYaml, events: TimelineEvent[]): string {
  const lines: string[] = [];

  lines.push("## Current Research State");
  lines.push("");
  lines.push(`- **Project**: ${state.project}`);
  lines.push(`- **Anchor**: ${state.anchor ?? "(not set)"}`);
  lines.push(`- **Target Venue**: ${state.config.venue ?? "(not set)"}`);
  lines.push(`- **Current Phase**: ${state.focus?.phase ?? "(not set)"}`);
  if (state.focus?.since) lines.push(`- **Phase Since**: ${state.focus.since.slice(0, 10)}`);
  if (state.focus?.summary) lines.push(`- **Focus**: ${state.focus.summary}`);
  if (state.focus?.blocked_on) lines.push(`- **⚠ BLOCKED**: ${state.focus.blocked_on}`);
  if (state.focus?.next) lines.push(`- **Next Step**: ${state.focus.next}`);
  lines.push("");

  // Counters
  lines.push("### Entity Counts");
  lines.push("");
  lines.push(
    `Ideas: ${state.counters.idea} | Plans: ${state.counters.plan} | Experiments: ${state.counters.exp} | Claims: ${state.counters.claim} | Exhibits: ${state.counters.exh} | Papers: ${state.counters.paper}`,
  );
  lines.push("");

  // Key refs
  if (state.focus?.refs) {
    const refs = state.focus.refs;
    const parts: string[] = [];
    if (refs.idea_ref) parts.push(`Idea: ${refs.idea_ref}`);
    if (refs.plan_ref) parts.push(`Plan: ${refs.plan_ref}`);
    if (refs.experiment_refs?.length) parts.push(`Experiments: ${refs.experiment_refs.join(", ")}`);
    if (refs.claim_refs?.length) parts.push(`Claims: ${refs.claim_refs.join(", ")}`);
    if (parts.length) {
      lines.push("### Active References");
      lines.push("");
      lines.push(parts.join(" | "));
      lines.push("");
    }
  }

  // Recent activity
  if (events.length > 0) {
    lines.push("### Recent Activity");
    lines.push("");
    const recent = events.slice(-10);
    for (const ev of recent) {
      const ts = ev.ts.slice(5, 16).replace("T", " ");
      const summary = ev.summary ?? ev.type;
      lines.push(`- \`${ts}\` ${ev.type}: ${summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate full AGENTS.md content (used by research_init).
 */
export function generateAgentsMd(state: StateYaml): string {
  const sections: string[] = [];

  sections.push(`# ${state.project}`);
  sections.push("");
  sections.push(`> This file is auto-managed by research tools. Do NOT manually edit the dynamic state section.`);
  sections.push(
    `> Static rules are generated by \`research_init\`. Dynamic state is updated by \`research_state(action="brief")\`.`,
  );
  sections.push("");

  // Dynamic section with markers
  sections.push(DYNAMIC_MARKER_START);
  sections.push(generateDynamicSection(state, []));
  sections.push(DYNAMIC_MARKER_END);

  // Static section
  sections.push(STATIC_RULES);

  return sections.join("\n");
}

/**
 * Update only the dynamic section of an existing AGENTS.md.
 * Returns the full new content, or null if markers not found (triggers full regeneration).
 */
export function updateAgentsMdDynamic(
  existingContent: string,
  state: StateYaml,
  events: TimelineEvent[],
): string | null {
  // audit#2 P1-21 noted: when markers are duplicated, indexOf finds only the
  // FIRST pair and the second pair stays stale. The team intentionally tests
  // for the "use first pair" behavior (test/agents-md.test.ts), so we keep
  // this semantics. Detecting duplicates and emitting a warning is deferred
  // (see tmp/BUGS_TRIAGE_2026-05-19.md) — it requires either changing the
  // test expectation or auto-cleaning duplicate pairs.
  const startIdx = existingContent.indexOf(DYNAMIC_MARKER_START);
  const endIdx = existingContent.indexOf(DYNAMIC_MARKER_END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    log.error(
      "AGENTS.md",
      `Dynamic marker not found or malformed. Expected markers: ${DYNAMIC_MARKER_START} ${DYNAMIC_MARKER_END}`,
    );
    return null; // Markers not found or malformed — caller should regenerate full file
  }

  const before = existingContent.slice(0, startIdx);
  const after = existingContent.slice(endIdx + DYNAMIC_MARKER_END.length);

  return (
    before + DYNAMIC_MARKER_START + "\n" + generateDynamicSection(state, events) + "\n" + DYNAMIC_MARKER_END + after
  );
}
