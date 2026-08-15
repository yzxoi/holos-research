# holos-research v1.1.1 — Compose Quality Gates (unreleased)

## Summary

Paper-compose 升级为 contribution-first 工作流:写作前硬门禁 + 确定性检查脚本 + 场景化 playbook,参考 PaperSpine V4 的设计,适配 holos-research 对象模型。

## What's Changed

- **贡献契约前置 (Contribution-First)**: 写作前必须生成并通过 `contribution_check.py` 的 `confirmed_contribution.md`(四段式: Core Contribution / Why Needed / How Responds / Claim Boundary),每字段与 claim/experiment/exhibit 对象对齐
- **Results 验证矩阵 (Results-as-Validation)**: `results_validation.md` 七列表格(Results Unit / Claim Tested / Evidence / Figure-Table / Condition / Allowed / NOT Allowed),`results_validation_check.py` 拒绝 metric-only 行,防 overclaim
- **审稿人预演 (Reviewer-Audit)**: 写作前 `reviewer_audit.md` 登记审稿人异议(Reviewer Value Map + Objection Register + Editorial Fit),每个 objection 必须有 planned defense
- **场景化 playbook**: `scenario-journal.md` / `scenario-conference.md` 拆分,writing-guide 增加场景路由 + 贡献契约
- **5 个新检查脚本** (materialized to `.research/scripts/` on init): `compose_progress_check.py`(断点续跑) / `contribution_check.py` / `results_validation_check.py` / `latex_guard.py`(引用机制守卫: 禁字面 `[1]`、`\title` 必需、`\cite` 键校验) / `numeric_consistency_check.py`(数字一致性 advisory)
- **新目录** `.research/compose/` 存放 compose 阶段产物

---

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
