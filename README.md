# Holos Research

A [Synergy](https://github.com/SII-Holos/synergy) Plugin API 4 plugin for **structured research management** — from idea discovery through paper submission, with full state machine tracking, adversarial review, and audit trail.

> Research-group SOP for AI-assisted research. Public distribution.

## Overview

A research operating system for months-long projects:

- **1 project-level state machine** — 6 phases: explore → ground → design → realize → experiment → compose
- **7 object-level state machines** — Idea, Plan, Experiment, Claim, Exhibit, Paper, Submission
- **15 tools** — entity lifecycle management, checkpoint/monitor/journal, compute submission
- **4 specialized agents** — critic, methodologist, auditor, editor
- **17 skills** — per-phase skills + inner-loop iterations + cross-cutting orchestrators
- **5 utility scripts** — stats, plot, figure_renderer, paper_check, restatement_check
- **Embedded Monitor** — a trusted Solid workbench panel (side surface) rendering the workflow board, timeline, journal, entity summaries, research brief, diagnosis ladder, story radar, and pending human checkpoints. Data flows through typed query operations + a `research.changed` event (no polling).

Architecture:

```
Synergy (Plugin API 4)              .research/ (single source of truth)
────────────────────────────        ──────────────────────────────────
• definePlugin contributions        state.yaml + index.yaml
• 15 tool() + 9 operation()         ideas/ plans/ experiments/ claims/
• 4 agent() + 17 skill()            exhibits/ manuscripts/ submissions/
• ui.workbenchPanel (Monitor)       timeline.jsonl journal/ phase_runs/
• workspace.read/write Host APIs    literature/ positioning/ rqg/ diagnoses/
```

See [DESIGN.md](./DESIGN.md) for the full design document.

## Requirements

- Synergy `>= 3.0.11` (Plugin API 4)
- Bun 1.x for development

## Installation (local directory)

```bash
bunx synergy-plugin build
synergy plugin add file:///absolute/path/to/holos-research
synergy plugin approve holos-research
```

The plugin requests only `workspace.read` and `workspace.write` capabilities. Approved plugins show a **Research Monitor** workbench panel; open it from the workbench surface. Each Scope with a `.research/` project gets its own monitor tab.

## Development

```bash
bun install
bun run gen        # regenerate src/generated/assets.ts from agents/ + scripts/
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun test           # bun test (isolated: bun test --isolate)
bun run build      # synergy-plugin build
bun run validate   # synergy-plugin validate --runtime-discovery
bun run pack       # synergy-plugin pack
```

Live development against an isolated Synergy instance:

```bash
synergy-plugin dev --server-url http://127.0.0.1:PORT
```

## Tools

| Tool | Actions | Purpose |
|------|---------|---------|
| `research_init` | — | Initialize `.research/` + materialize bundled scripts |
| `research_state` | read, advance, redirect, block, resume, brief, overview | Project-level state machine (6 phases) |
| `research_idea` | create, derive, update, select, park, reject, review, list | Idea lifecycle + review sidecar |
| `research_plan` | create, refine, approve, activate, supersede, cancel, review, list, update | Method plan lifecycle |
| `research_experiment` | register, schedule, start, complete, fail, invalidate, stop, review, list, compare, update | Experiment lifecycle + compute integration |
| `research_claim` | create, support, qualify, weaken, retract, finalize, review, trace, list, update | Claim-evidence matrix |
| `research_exhibit` | create, bind_sources, render, verify, approve, supersede, drop, review, list, update | Figure/table provenance |
| `research_paper` | create, sync_source, advance, archive, review, bind, list, update | Manuscript lifecycle |
| `research_submission` | create, submit, record_round, enter_rebuttal, request_revision, resubmit, close, review, list, update | Venue interaction lifecycle |
| `research_wiki` | ingest_paper, link, register_gap, update_entry, query, lint, verify_bib, stats | Literature knowledge base (DBLP→S2→arXiv→CrossRef) |
| `research_timeline` | read, append_free_event | Append-only research history |
| `research_monitor` | workflow, phase, entities, timeline, journal, active_run | Agent-facing dashboard views |
| `research_journal` | append_note, query, human_decisions | Research journal (append-only) |
| `compute_submit` | interactive, distributed | SII Inspire compute submission (lazy kit) |
| `research_checkpoint_brief` | — | Generate pending checkpoint brief |

Monitor query operations (UI-facing): `monitor.all`, `monitor.workflow`, `monitor.phase`, `monitor.entities`, `monitor.timeline`, `monitor.journal`, `monitor.activeRun`, `monitor.brief`, `monitor.checkpointSummary`.

## Agents

| Agent | Purpose |
|-------|---------|
| `critic` | Adversarial evaluation — challenges novelty, method, claims, paper quality. 8 core tests, structured scoring. |
| `methodologist` | Constructive design — methods, experiment matrices, baselines, ablations, validation strategies. |
| `auditor` | Forensic verification — data provenance, citation accuracy, figure-data consistency, reproducibility. |
| `editor` | Writing review — narrative structure, argument flow, prose quality, visual presentation. |

## Skills

| Skill | Phase | Purpose |
|-------|-------|---------|
| `research` | orchestrator | Route to phase skill, manage transitions and rollbacks |
| `idea-explore` | explore | Multi-agent survey + ideation + filtering |
| `novelty-ground` | ground | Closest-work search + adversarial novelty validation |
| `method-design` | design | Method design + multi-round review + experiment planning |
| `method-realize` | realize | Implement method into production-ready code artifacts |
| `experiment-cycle` | experiment | Submit/monitor/collect/diagnose/supplement |
| `experiment-iterate` | experiment | Result-driven optimization cycle with config adequacy guard |
| `claim-build` | compose | Evidence→claim mapping + overclaim detection |
| `paper-compose` | compose | Contribution-first manuscript: pre-writing gates, exhibits, narrative writing, LaTeX guards |
| `paper-revise` | compose | Feedback-driven targeted manuscript revision |
| `paper-audit` | compose | 7-dimension check + multi-round fix loop |
| `venue-cycle` | compose | Submission/review/rebuttal/revision lifecycle |
| `project-archive` | compose | Freeze snapshot + generate supplementary bundle |
| `idea-refine` | cross-cutting | Incremental idea optimization from feedback |
| `method-iterate` | cross-cutting | Feedback-driven plan revision |
| `lit-knowledge` | cross-cutting | Literature knowledge base management |
| `peer-review` | cross-cutting | Orchestrate adversarial review at any stage |

## Scripts

Materialized to `.research/scripts/` on `research_init` (skip existing).

| Script | Purpose |
|--------|---------|
| `stats.py` | Statistical testing: t-test, bootstrap CI, Cohen's d, comparison tables |
| `plot.py` | 10 chart types × 5 themes. CLI + library |
| `figure_renderer.py` | Deterministic JSON → SVG architecture diagram renderer |
| `paper_check.sh` | LaTeX compilation + structured JSON diagnostic report |
| `restatement_check.py` | Theorem statement regression test |
| `compose_progress_check.py` | Compose stage gate progress / resume checkpoint |
| `contribution_check.py` | Pre-writing contribution contract gate |
| `results_validation_check.py` | Results-as-validation matrix gate |
| `latex_guard.py` | Citation mechanism guard (literal `[1]`, `\title`, `\cite` keys) |
| `numeric_consistency_check.py` | Paper-vs-experiment numeric consistency (advisory) |

Themes: clean-modern, nature-elegant, neurips-vivid, warm-minimal, monochrome-pro

## Persistence

All research state lives in `.research/` at the Scope root — the single source of truth, fully compatible with the legacy (API3) plugin data layout:

```
.research/
├── state.yaml                 # Project state machine
├── index.yaml                 # Entity index (enumeration source for the workspace API)
├── timeline.jsonl             # Append-only history
├── ideas/ plans/ experiments/ claims/ exhibits/
├── manuscripts/ submissions/ literature/
├── phase_runs/ journal/ snapshots/
├── positioning/ code_artifacts/ rqg/ diagnoses/ checkpoint_briefs/
└── scripts/                   # Bundled utility scripts + themes/
```

Legacy projects created before the index are bootstrapped automatically on first read (one-time scan).

## License

MIT — Copyright (c) 2026 [yzxoi](https://github.com/yzxoi)
