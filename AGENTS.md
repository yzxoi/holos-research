# AGENTS.md — holos-research Development Guide

## What This Is

Synergy Plugin API 4 plugin that powers the full research lifecycle — from idea exploration to paper submission. Provides 15 tools (`research_init`, `research_state`, `research_idea`, `research_plan`, `research_experiment`, `research_claim`, `research_exhibit`, `research_paper`, `research_submission`, `research_wiki`, `research_timeline`, `research_monitor`, `research_journal`, `compute_submit`, `research_checkpoint_brief`), 17 skills, 4 agents, and an embedded Solid Monitor workbench panel that orchestrate multi-agent, months-long research projects.

## Project Layout

```
src/
├── index.ts           # definePlugin(): 15 tools + 4 agents + 17 skills + 9 operations + workbenchPanel
├── operations.ts      # monitor.* query operations (UI data contract, event-driven refresh)
├── ctx.ts             # Invocation context: AsyncLocalStorage directory + workspace Host Service
├── fs.ts              # File I/O via workspace.read/write + index-aware listYaml
├── index-registry.ts  # .research/index.yaml entity index (enumeration source, legacy bootstrap)
├── schema.ts          # Zod schemas for all YAML entity types (single source of truth)
├── id.ts              # Auto-incrementing ID generation (idea_001, exp_007, ...)
├── timeline.ts        # Timeline event append/query
├── review.ts          # Shared review recording logic
├── monitor.ts         # MonitorBoard aggregation (workflow/phase/entities/timeline/journal/brief)
├── generated/assets.ts# Generated: agents/*.md + scripts/** inlined at build time
├── ui/                # Trusted Solid workbench panel (monitor-panel.tsx + components/)
├── tools/
│   ├── shared.ts      # Error helpers: notInitialized, notFound, corruptFileResult, withGuard
│   ├── init.ts        # research_init
│   ├── state.ts       # research_state (phase machine + anchor)
│   ├── idea.ts        # research_idea (CRUD + status lifecycle)
│   ├── plan.ts        # research_plan
│   ├── experiment.ts  # research_experiment
│   ├── claim.ts       # research_claim
│   ├── exhibit.ts     # research_exhibit
│   ├── paper.ts       # research_paper
│   ├── submission.ts  # research_submission
│   ├── wiki.ts        # research_wiki (literature knowledge base)
│   ├── monitor.ts     # research_monitor (agent-facing dashboard views)
│   ├── journal.ts     # research_journal
│   ├── compute.ts     # compute_submit (SII Inspire, lazy kit)
│   ├── checkpoint-brief.ts # research_checkpoint_brief
│   └── timeline.ts    # research_timeline (read/append free events)
├── match/             # Paper metadata matching (title, author, Hungarian algorithm)
├── resolve/           # Literature metadata resolution (DBLP/S2/arXiv/CrossRef/OpenAlex/DataCite)
└── ...                # review/diagnosis/rqg/story/overview/brief-render/checkpoint-context/phase-run/snapshot/journal
```

## Persistence

All research state lives in `.research/` at the Scope root — the single source of truth, fully compatible with the legacy (API3) plugin data layout:

```
.research/
├── state.yaml         # Project state machine (6 phases: explore → ground → design → realize → experiment → compose)
├── index.yaml         # Entity index (enumeration source for the workspace API)
├── timeline.jsonl     # Append-only history
├── ideas/ plans/ experiments/ claims/ exhibits/
├── manuscripts/ submissions/ literature/
├── phase_runs/ journal/ snapshots/
├── positioning/ code_artifacts/ rqg/ diagnoses/ checkpoint_briefs/
└── scripts/           # Bundled utility scripts + themes/
```

Legacy projects created before the index are bootstrapped automatically on first read (one-time scan).

## Development

```bash
bun install
bun run gen        # regenerate src/generated/assets.ts from agents/ + scripts/
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun test           # bun test --isolate (full suite)
bun run build      # synergy-plugin build
bun run validate   # synergy-plugin validate --runtime-discovery
bun run pack       # synergy-plugin pack
```

## Conventions

- Tools are defined with the API3-style `tool({ description, args, execute })` factory from `@ericsanchezok/synergy-plugin/tool`; `src/index.ts` adapts them to API4 `tool({ id, description, input, handler })` contributions via `adaptTool`, binding the host workspace service into the invocation context.
- Mutating tools publish `research.changed` so the Monitor panel re-queries (event-driven refresh replaces polling).
- File access goes through `ResearchFS` which routes to the workspace Host Service when bound, and falls back to direct fs in bare tests.
- Never bypass the entity index for enumeration; register new write paths in `index-registry.ts` buckets.
- Test files live under `test/`; use `seedProject` + `stubWorkspace` fixtures from `test/helpers.ts`.
