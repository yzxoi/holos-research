# holos-research v1.0.0 — Release Notes

## Summary

holos-research is now a **Synergy Plugin API 4** plugin: structured research management from idea discovery through paper submission, with full state machine tracking, adversarial review, and an audit trail.

This is the first public release of the API4 rewrite, migrated from the legacy API3 plugin (`SII-Holos/holos-research`, commit `d4161d44`).

## What's Included

- **15 tools** — `research_init`, `research_state`, `research_idea`, `research_plan`, `research_experiment`, `research_claim`, `research_exhibit`, `research_paper`, `research_submission`, `research_wiki`, `research_timeline`, `research_monitor`, `research_journal`, `compute_submit`, `research_checkpoint_brief`
- **9 monitor query operations** (`monitor.all` / `workflow` / `phase` / `entities` / `timeline` / `journal` / `activeRun` / `brief` / `checkpointSummary`) backing the embedded panel
- **4 agents** — critic, methodologist, auditor, editor
- **17 skills** — per-phase skills + inner-loop iterations + cross-cutting orchestrators
- **Embedded Monitor workbench panel** (trusted Solid UI, side surface, multi-resource)
  - Workflow board, phase flow topology, timeline feed, journal feed, entity summaries, research brief, diagnosis ladder, story radar, progress ring, spark area, phase detail drawer
  - Event-driven refresh via `research.changed` (no polling)
  - Pending human checkpoint banner with in-panel phase navigation
  - Host semantic tokens, `holos-` prefixed classes, SVG self-drawn charts (zero new runtime deps)
- **Workspace Host Service file layer** — `.research/` reads/writes through `workspace.read/write` with a durable `.research/index.yaml` entity index (replaces readdir enumeration)
  - Legacy projects (API3-era) are auto-bootstrapped on first read (one-time scan, no data migration needed)
- **5 utility scripts** materialized to `.research/scripts/` on `research_init` (stats, plot, figure_renderer, paper_check, restatement_check)
- 688 passing tests (core logic ported 1:1 from the baseline)

## Breaking Changes vs the Legacy Plugin

- Host tool names are namespaced: `plugin__holos-research__research_*` (API4 contract)
- The standalone Monitor HTTP server (`:5174`) and React SPA are **removed**; the Monitor is now the embedded workbench panel
- Plugin requires approval on install for `workspace.read` + `workspace.write` only
- RCM / RDC / OSS integrations are **not** included in this release (removed from scope)

## Compatibility

- Synergy `>= 3.0.11` (Plugin API 4)
- `.research/` data layout fully compatible with the legacy plugin; `index.yaml` is generated automatically

## Install

```bash
synergy plugin add file:///path/to/holos-research-1.0.0.synergy-plugin.tgz
synergy plugin approve holos-research   # or approve from the Plugins workspace
```

## Verification

- `typecheck` / `lint` / 688 tests / `build` / `validate --runtime-discovery` / `pack` all pass
- Isolated-instance E2E: plugin loads with 15 tools + 4 agents + 17 skills + 9 operations + 1 panel; `monitor.all` returns full dashboard data; UI/runtime assets served; legacy project bootstrap verified
- Root repo `quality:quick` unaffected (plugin is a standalone directory)
