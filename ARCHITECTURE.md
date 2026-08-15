# Holos-Research 架构设计文档

> **Version**: V2.1.2 | **Date**: 2026-05-15 | **Status**: Active

---

## 1. 系统概述

Holos-Research 是一个 AI 辅助科研自动化 pipeline，运行于 Synergy 插件框架之上。它将完整的学术研究流程——从 idea 发掘到论文投稿——建模为可执行、可追溯、可回滚的状态机驱动系统。

**核心理念**：

- **Human-Centered Research Acceleration**：人类定义方向、做出关键决策；AI 负责执行、验证、记录。每次阶段推进都需经过 Human Checkpoint 确认（通过 `research_state(action="confirm_checkpoint")` 或 `action="waive_checkpoint"` 解决）。
- **过程即资产**：研究过程中的每一次决策、每一条 Timeline 事件、每一份 Review 记录都被持久化。即使最终 pivot 或 abort，整个过程仍然是有价值的研究资产。

**技术栈**：TypeScript + Bun runtime，Zod schema 验证，YAML/JSONL 持久化，React + Framer Motion 监控面板。

---

## 2. 整体架构

系统采用四层架构，侧边挂载 Monitor Board：

```
┌─────────────────────────────────────────────────┐
│            Synergy Plugin Layer                  │
│   14 tools · 17 skills · 5 sub-agents           │
│   wrapTool() → project dir context injection     │
├─────────────────────────────────────────────────┤
│            Research Engine                       │
│   PhaseRunManager · Inner Loop Engine            │
│   Entity CRUD + Review · Snapshot · Journal      │
│   RQG · Diagnosis · Research Integrity (R1-R7)   │
├─────────────────────────────────────────────────┤
│            Infrastructure                        │
│   ResearchFS (atomic write) · AsyncMutex         │
│   LazyScopedMutex · ResearchId · Timeline        │
├─────────────────────────────────────────────────┤
│            Persistence                           │
│   YAML (state/entities) · JSONL (timeline/log)   │
│   Markdown (content) · Snapshots (tar)           │
└──────────────────────────┬──────────────────────┘
                           │ read-only
                    ┌──────┴──────┐
                    │ Monitor Board│
                    │ HTTP + React │
                    └─────────────┘
```

### 2.1 Synergy Plugin Layer

顶层的 Synergy Plugin 注册了 14 个工具、17 个技能和 5 个子代理。所有工具通过 `wrapTool()` 注入项目目录上下文，确保多项目场景下的路径隔离。

**关键职责**：

- **工具注册**：将 `research_init`、`research_state`、`research_idea` 等 14 个工具注册到 Synergy 框架
- **技能路由**：`research` 技能作为路由层，读取当前 state 后分派到对应阶段技能
- **子代理管理**：5 个专业子代理（critic / methodologist / auditor / editor / inspector）以 `subagent` 模式运行

### 2.2 Research Engine

核心研究引擎，管理状态机、PhaseRun 生命周期、实体 CRUD 和研究诚信体系。

**关键职责**：

- **PhaseRunManager**：PhaseRun 的创建、推进、pivot、abort 全生命周期管理
- **Inner Loop Engine**：attempt → evaluate → decide 的内层迭代循环，含 budget 强制执行（`enforceBudget` 在 `updateActivePhaseRun` 和 `recordAttempt` 中调用）和 stagnation 检测
- **Entity CRUD + Review**：7 种研究实体的增删改查，以及结构化 Review 系统（4 种 reviewer role：inspector/auditor/critic/editor）
- **Snapshot / Journal / RQG / Diagnosis**：快照管理、决策日志、Research Quality Gate 报告、实验诊断

### 2.3 Infrastructure

文件系统抽象、并发控制、ID 生成和时间线持久化。

**关键职责**：

- **ResearchFS**：所有文件操作的统一入口，包含 path traversal 防护、原子写入（write-to-temp-then-rename + yamlWriteMutex）和加锁 JSONL 追加
- **AsyncMutex + LazyScopedMutex**：基于项目目录的 scoped 互斥锁
- **ResearchId**：自增计数器生成实体 ID（如 `idea_001`、`exp_007`），与 stateMutex 协调防止 lost-update
- **ResearchTimeline**：JSONL 格式的事件流，记录所有状态变更

### 2.4 Monitor Board（侧边）

独立运行的 HTTP 服务 + React SPA，提供研究进度的实时可视化。

**交互方式**：Monitor Board 仅读取 `.research/` 目录下的数据，不产生写入。通过 12 个 REST endpoint 暴露数据，前端以 10s/30s 间隔轮询。

---

## 3. 状态机设计

### 3.1 外层状态机：Phase 生命周期

6 阶段线性主链：`explore → ground → design → realize → experiment → compose`

每个阶段对应一个 PhaseRun 实例，PhaseRun 的生命周期状态：

```
                  ┌──────────┐
         ┌───────►│  active   │◄───────┐
         │        └────┬─────┘        │
         │             │              │
    (blocked)    advance/redirect    (unblock)
         │             │              │
         ▼             ▼              │
   ┌──────────┐  ┌──────────┐        │
   │ blocked  │  │ promoted │        │
   └──────────┘  └──────────┘        │
                       │              │
                ┌──────┤              │
                │      │              │
                ▼      ▼              │
         ┌────────┐ ┌───────┐        │
         │pivoted │ │aborted│        │
         └────────┘ └───────┘        │
```

| 状态         | 含义            | 终态  |
| ---------- | ------------- | --- |
| `active`   | 当前活跃阶段        | 否   |
| `promoted` | 成功推进到下一阶段     | 是   |
| `pivoted`  | 因证据不足/方向错误而转向 | 是   |
| `aborted`  | 研究终止          | 是   |
| `blocked`  | 等待外部资源（计算/人工） | 否   |

`blocked` 状态由 `research_state(action="block")` 设置（同时更新 PhaseRun status），由 `action="resume"` 恢复为 `active`。`aborted` 状态由 `action="abort"` 设置（调用 `PhaseRunManager.abort()`，清除 `state.focus`）。

### 3.2 内层状态机：Inner Loop

每个 active PhaseRun 内部运行一个 inner loop 状态机：

```
attempt → evaluate → decide ─┬→ attempt (iterate, round++)
                              ├→ promoted (phase 成功)
                              ├→ pivoted (phase 转向)
                              └→ aborted (phase 终止)
```

Inner loop 状态通过 `research_state(action="inner_loop_transition", target_state=...)` 和 `action="record_decision", inner_decision=...` 控制。

**Inner Loop Budget**：

- `max_attempts`: 每轮最大尝试次数（默认 6）
- `max_stagnation`: 允许的停滞轮数（默认 2）
- `max_escalations`: 允许的升级次数（默认 2）

Budget 在 `updateActivePhaseRun` 中自动检查（advisory — 仅记录警告，不阻止操作）。当 `attempts > max_attempts` 时，`enforceBudget` 返回 `must_decide`（建议 pivot 或 abort），日志记录警告。当 `stagnation > max_stagnation` 时，返回 `must_escalate`（建议重定向或请求人类介入）。`recordDecision(action="iterate")` 在 budget 耗尽时会被拒绝，防止通过 iterate 重置 attempt 计数绕过预算。

### 3.3 两次 Advance 模式

阶段推进采用 checkpoint → 确认 → 实际转换的两步模式：

1. **第一次 advance 调用**：系统添加 HumanCheckpoint（如 `taste_selection`、`resource_commitment`），然后返回"请先确认 checkpoint"
2. **人类确认 checkpoint**：通过 `research_state(action="confirm_checkpoint", checkpoint_kind=..., decision=...)` 或 `action="waive_checkpoint", checkpoint_kind=..., reason=...` 解决
3. **第二次 advance 调用**：检测到无 pending checkpoint，执行实际转换

这种设计确保 checkpoint 不会"空转"——添加即等待，确认即推进。

**例外**：`research_init` 在创建初始 explore PhaseRun 时有意跳过两步模式，因为初始化不需要 checkpoint 审批。

### 3.4 Pivot vs Redirect

| 维度   | Pivot                                    | Redirect                            |
| ---- | ---------------------------------------- | ----------------------------------- |
| 触发方式 | 内层 decide 返回 pivot                       | `research_state(action="redirect")` |
| 方向   | 当前 PhaseRun 内部记录 pivot 信息                | 可跳转到任意阶段                            |
| 人类确认 | pivot_confirmation checkpoint            | 同样需要 pivot_confirmation             |
| 适用场景 | 实验失败、方法不可行                               | 审稿人要求、scope 变更                      |
| 共同点  | 都创建新的 PhaseRun，都写入 Timeline，都生成 Snapshot | 同                                   |

---

## 4. 实体体系

### 4.1 七种研究实体

```
Idea ──► Plan ──► Experiment
  │                    │
  │                    ▼
  │              Claim ◄── Exhibit
  │                │
  └────────────────┤
                   ▼
                Paper ──► Submission
```

### 4.2 实体状态详解

所有 7 种实体都有 `TRANSITIONS` 映射表，在状态变更时进行转换验证。`update` action 可以绕过验证（会记录 warning 日志），但语义 action（create/select/approve/complete 等）必须遵循合法转换路径。

| 实体             | ID 前缀    | 状态流                                                                                           | 核心阶段           |
| -------------- | -------- | ------------------------------------------------------------------------------------------- | -------------- |
| **Idea**       | `idea_`  | proposed → exploring → grounding → selected → parked/rejected                              | explore/ground |
| **Plan**       | `plan_`  | draft → refining → approved → active → superseded/cancelled                                | design         |
| **Experiment** | `exp_`   | registered → scheduled → running → completed/failed/stopped; any non-terminal → invalidated | experiment     |
| **Claim**      | `claim_` | candidate → supported → qualified → weak → retracted/final                                  | compose        |
| **Exhibit**    | `exh_`   | draft → rendered → verified → approved → superseded/dropped                                 | compose        |
| **Paper**      | `paper_` | outlined → drafting → revising → ready → frozen → archived                                  | compose        |
| **Submission** | `sub_`   | preparing → submitted → under_review → rebuttal → accepted/rejected/closed; revision_requested/resubmitted (V2.1 新增) | compose        |

**关键约束**：

- Claim `finalize` 必须通过 red-line 检查：所有 evidence 实验的 red-line 必须为 passed/waived，authenticity 必须为 `evidence`。不满足时返回错误而非静默跳过。
- Claim `qualify` 会软检查 red-line，发现违规时记录警告但不阻止转换。
- Exhibit 的 `approved` 是终态（无 `final` 状态）。
- Experiment 的 `schedule`/`start`/`complete`/`stop`/`invalidate` 都验证前置状态。

### 4.3 双文件模式

每个实体采用三文件存储：

```
ideas/
├── idea_001.yaml          # 工具管理的结构化元数据（status, refs, scores）
├── idea_001.md            # Agent 编辑的自由格式内容（分析、论述）
└── idea_001.reviews.jsonl # 结构化 Review 记录（每行一个 ReviewEntry）
```

- **`.yaml`**：由工具管理，Agent 不应直接编辑。包含 status、refs、计数器等。
- **`.md`**：Agent 可自由编辑的研究内容，用于论文论述、实验日志等。
- **`.reviews.jsonl`**：Review 系统 append-only 写入，包含 verdict、scores、action_items。Reviewer role 必须为 inspector/auditor/critic/editor 之一（schema 层强制）。

### 4.4 StorySpine

StorySpine 是 V2.1 引入的叙事骨架，连接 Idea 和最终的 Paper 角度：

```
field_assumption → pain_point → non_obvious_insight → what_changes_if_true
                                    ↓
                          candidate_paper_angles[]（类型: new_method/new_problem/...）
                                    ↓
grounded_angle ← closest_work_positioning ← reframe_history
```

StorySpine 在 explore 阶段创建，在 ground 阶段被 grounding 和 reframing 更新。

---

## 5. Phase-Tool 映射

| Phase          | 核心工具                                                   | 关键 Actions                                        | Inner Loop Update                                               |
| -------------- | ------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------- |
| **explore**    | `research_idea`, `research_wiki`                       | create/explore/select idea, ingest papers         | attempt on idea create, evaluate on review, select→attempt      |
| **ground**     | `research_idea`, `research_wiki`                       | ground idea, register gaps, build positioning     | evaluate on novelty check, decide on grounding result           |

### 5.1 Wiki Entity Existence Validation

The `entityExists` helper is used by `research_wiki` to validate that referenced entity IDs actually exist in the `.research/` directory before allowing operations that depend on them. This applies to gap IDs in particular: when `registerGap` or `updateEntry` references a gap ID (e.g., `gap_001`), `entityExists` verifies that the gap entry exists in `literature/gap_map.yaml`. If the gap ID does not exist, the operation is rejected with a clear error message rather than silently creating a dangling reference. This prevents orphaned gap references from accumulating in the literature knowledge base.
| **design**     | `research_plan`                                        | create/approve plan, set kill/sufficient criteria | attempt on plan draft, evaluate on review scores, approve→attempt |
| **realize**    | `research_plan`                                        | realize plan, code review, sanity contract (local <5 min only — `compute_submit` is NOT permitted in realize; advance to `experiment` to submit jobs) | attempt on implementation, evaluate on code review              |
| **experiment** | `research_experiment`, `compute_submit`                | register/run/complete experiment, RQG report      | attempt on job submit, evaluate on results, decide on diagnosis |
| **compose**    | `research_claim`, `research_exhibit`, `research_paper` | build claims, create exhibits, write paper        | attempt on draft, evaluate on review, decide on revision        |

**updateActivePhaseRun 行为**：每个工具在执行核心操作时，会调用 `updateActivePhaseRun(phase, {...})` 非阻塞地更新当前 PhaseRun 的 inner loop 状态（incrementAttempts / state transition / summary）。这是 best-effort 的——如果 PhaseRun 不存在或 phase 不匹配，操作会被静默跳过。调用后还会自动执行 `enforceBudget` 检查，超出 budget 时记录警告。

---

## 6. 并发安全设计

### 6.1 AsyncMutex + LazyScopedMutex

```typescript
class AsyncMutex {
  acquire(): Promise<void>  // 获取锁
  release(): void           // 释放锁
}

class LazyScopedMutex extends AsyncMutex {
  // 延迟解析：scope key 在 acquire 时计算，而非模块加载时
  // 格式："{projectDir}:{resourceName}"
  // 注意：继承的 queue/locked 字段在 LazyScopedMutex 中未使用，实际操作委托给 resolve() 后的真实 mutex
}
```

LazyScopedMutex 解决了一个关键问题：模块级别的 `const m = getMutex("state")` 在 `initContext()` 之前执行，此时项目目录尚未确定。通过延迟解析，同一个 `getMutex("state")` 在不同项目下会指向不同的锁实例。

### 6.2 Mutex 清单

| Mutex 名称       | 保护对象              | 使用位置                                                       |
| -------------- | ----------------- | ---------------------------------------------------------- |
| `state`        | state.yaml 读写 + ID 生成 | research_state execute 函数（统一加锁）、ResearchId.next()       |
| `phase_run`    | PhaseRun 文件读写     | PhaseRunManager (create/update/promote/pivot/abort/checkpoint) |
| `yaml_write`   | YAML 文件原子写入       | ResearchFS.writeYaml()                                     |
| `jsonl_append` | JSONL 文件追加        | ResearchFS.appendJsonl()                                   |
| `review`       | Review round number | ResearchReview.addReview()                                 |
| `agents_md`    | AGENTS.md 写入      | research_state handleBrief()                               |
| `note`         | Journal 写入        | ResearchJournal.appendNote()                               |
| `wiki`         | Wiki/literature 写入 | research_wiki handleIngestPaper/handleRegisterGap/handleUpdateEntry |

**锁层级**：`state` → `phase_run`（`research_state` 的 execute 函数在 `stateMutex` 下调用 PhaseRunManager 方法，PhaseRunManager 内部获取 `phaseRunMutex`）。当前代码中不存在反向顺序，但未强制执行锁层级。

### 6.3 原子文件写入

```typescript
// writeYaml: write-to-temp-then-rename + yamlWriteMutex
await withLock(yamlWriteMutex, async () => {
  await ensureDir(path.dirname(filePath))
  const text = YAML.stringify(data, { lineWidth: 0 })
  const tmpPath = filePath + ".tmp"
  await Bun.write(tmpPath, text)
  await fs.rename(tmpPath, filePath)
})
```

`yamlWriteMutex` 确保对同一 YAML 文件的并发写入操作序列化。POSIX `rename` 是原子操作，确保崩溃安全。

### 6.4 appendJsonl 加锁

```typescript
await withLock(jsonlAppendMutex, async () => {
  await fs.appendFile(filePath, line, "utf-8")
})
```

多个并发的 JSONL 追加操作（如同时记录 Timeline 事件和 Journal 条目）通过 mutex 序列化，防止行交叉。

### 6.5 Review round 竞争保护

```typescript
await withLock(reviewMutex, async () => {
  const round = await countReviews(entityDir)  // 读取当前 round
  await ResearchFS.appendJsonl(reviewsPath, entry)  // 追加新 review
})
```

`reviewMutex` 确保 countReviews→appendJsonl 的 read-modify-write 序列不被并发请求打断。

---

## 7. 研究诚信体系

### 7.1 Red-Line 系统（R1-R7）

| Rule                   | 含义               | 检查时机   |
| ---------------------- | ---------------- | ------ |
| R1_metric_immutability | 指标定义不可在实验后修改     | 实验注册时  |
| R2_eval_integrity      | 评估流程不可被训练数据污染    | 实验设计审计 |
| R3_no_data_leakage     | 训练/测试数据严格分离      | 实验设计审计 |
| R4_honest_reporting    | 报告结果必须与原始输出一致    | 结果记录时  |
| R5_dataset_integrity   | 数据集版本和预处理可追溯     | 实验审计   |
| R6_reproducibility     | 实验 seed、环境、代码可复现 | 实验完成时  |
| R7_domain_constraints  | 领域特定约束（如公平性）     | 实验审计   |

**Red-Line 状态机**：

```
pending → {passed, flagged, violated}
flagged → {passed, violated, waived}
violated → waived
passed: terminal | waived: terminal
```

转换验证在 `experiment.ts handleUpdate` 中执行——非法转换（如 violated→passed）会记录警告但仍应用（与 inner loop 相同的 best-effort 模式）。

**Final Claim 保护**：`claim.ts handleFinalize` 强制检查所有 evidence 实验的 red-line 状态。任何非 waived 的 violated red-line 阻止 finalize。`update` action 可绕过（记录警告），但语义 action 不能。

### 7.2 证据等级

```
prototype → pilot → evidence
```

- **prototype**：概念验证，小规模运行
- **pilot**：中等规模，初步统计检验
- **evidence**：完整规模，多 seed 验证，统计显著性确认

只有 `evidence` 等级的实验才能支持 `final` 级别的 Claim（在 `handleFinalize` 中强制）。

### 7.3 Kill/Sufficient Criteria

Plan 定义两组 gate criteria：

- **Kill Set**：如果任何一个 Kill Criterion 不通过，Plan 必须被 pivot 或 abort。包含 metric、direction、baseline_value（§7.3 指定为必需，当前保持 optional 以兼容迁移数据）、min_effect_size、statistical_test。
- **Sufficient Set**：如果所有 Sufficient Criterion 都通过，Plan 可以被 promote。包含 metric、direction、target_value。

当 Kill criteria 失败时，RQG 报告设置 `kill_criteria_failed: true`，`disallowed_next: ["promote"]`。`handleComplete` 检测到此标志时发出警告。Kill criteria 失败时建议 pivot 但不自动执行（advisory）。

### 7.4 RQG Report 和 Diagnosis Report

**RQG Report**（Research Quality Gate）：

- 评估 Kill Set 和 Sufficient Set 的通过情况
- 完整性检查：
  - `metric_recompute`：验证至少一个已完成实验有非空 metrics 字段（非 auto-pass）
  - `artifact_hash`：验证至少一个已完成实验有非空 code_artifact_ref（非 auto-pass），缺失时标记为 "flagged"
  - `redlines`：检查所有已完成实验的实际 red-line 状态，`passed`/`waived`/`flagged` 均视为通过（flagged 为审核中状态，不阻止）
- 总体结论：passed / partial / failed / invalid
- 路由建议：allowed_next / disallowed_next
- Kill criteria 失败标志：`kill_criteria_failed: boolean`
- 诚信诊断备注：`integrity_notes: string[]`（可选项，记录 metric/artifact/redline 检查细节，YAML round-trip 安全）

**Diagnosis Report**：

- 6 层诊断：L1(training_health) → L2(eval_correctness) → L3(data_integrity) → L4(hyperparameter_range) → L5(seed_stability) → L6(benchmark_story_alignment)
- 每层输出：pass / warning / fail / pending + evidence + recommended_action
- 结论：likely_cause + recommended_decision (iterate/pivot/promote/abort) + forbidden_decisions
- 通过 `research_experiment(action="update_diagnosis")` 填充 L1-L6 层级和结论
- 填充结论后自动调用 `determinePivotRoute` 提供路由建议

### 7.5 Review 系统

每个实体都支持结构化 Review：

| Reviewer 角色   | 职责                         | 时机                       |
| ------------- | -------------------------- | ------------------------ |
| **inspector** | 代码质量审计（Gate 1）             | 实验提交前                    |
| **auditor**   | 研究诚信审计（Gate 2），Red-Line 检查 | 实验注册/完成时                 |
| **critic**    | 对抗性评估，overclaim 检测         | Idea/Plan/Claim/Paper 阶段 |
| **editor**    | 写作质量审查                     | Paper 阶段                 |

Reviewer role 在 schema 层为 `z.string()`（保持向后兼容，允许已有 reviews.jsonl 中的自由格式字符串），但工具输入参数使用 `z.enum(["inspector", "auditor", "critic", "editor"])` 强制新 Review 的 role。`addReview` 在运行时验证 role 合法性。

Review 记录包含：verdict (pass/revise/rethink) + scores + action_items + review_file (完整 Review 正文)。

---

## 8. 技能路由系统

### 8.1 路由层

`research` 技能作为路由层：每次调用时读取 `state.yaml`，根据 `focus.phase` 分派到对应阶段技能。它同时加载 `AGENTS.md` 中的行为规则和当前研究状态。

Compose 阶段使用消歧逻辑：
- 无 claims → claim-build（先构建 claims）
- 有 claims 但无 paper → paper-compose
- Paper 需要审计 → paper-audit
- Paper 准备投稿 → venue-cycle
- Paper 需要修订 → paper-revise

### 8.2 17 个技能分类

**初始技能**（进入阶段时触发）：

| 技能                 | 阶段         | 功能                                                  |
| ------------------ | ---------- | --------------------------------------------------- |
| `idea-explore`     | explore    | 多轮多 Agent idea 发掘，含学术/工业/开源分层调研                     |
| `novelty-ground`   | ground     | 最近工作搜索、贡献分类、对抗性 review、定位矩阵                         |
| `method-design`    | design     | 五维度并行设计：方法/基准/数据集/baseline/评估                       |
| `method-realize`   | realize    | 代码实现、sanity/quality contract、code review gate       |
| `experiment-cycle` | experiment | 双 gate 完整性：inspector(Gate1) + auditor(R1-R7, Gate2) |
| `claim-build`      | compose    | 结构化 claim 构建、evidence chain、overclaim 检测            |
| `paper-compose`    | compose    | 从 claims 到完整论文：exhibit 生成、section 写作、LaTeX 编译       |

**迭代技能**（反馈驱动的增量优化）：

| 技能                   | 阶段              | 功能                                                   |
| -------------------- | --------------- | ---------------------------------------------------- |
| `idea-refine`        | explore         | 基于反馈的 idea 增量优化，含 anchor drift 检查                    |
| `method-iterate`     | design, realize | 反馈驱动的 plan 修订，分类 feedback 类型                         |
| `experiment-iterate` | experiment      | 结果驱动的实验优化，含 config adequacy guard 和 regression guard |

**横切技能**（任何阶段可手动调用）：

| 技能                | 功能                      |
| ----------------- | ----------------------- |
| `lit-knowledge`   | 文献知识库管理：论文摄入、关系图、gap 注册 |
| `peer-review`     | 结构化对抗性评估，支持并行独立 review  |
| `paper-audit`     | 投稿前 7 维度质量保证（compose 阶段常用） |
| `paper-revise`    | 反馈驱动的论文修订（compose 阶段常用）  |
| `venue-cycle`     | 投稿/审稿/rebuttal/修订全流程（compose 阶段常用） |
| `project-archive` | 冻结和归档完整研究记录（非阶段路由，手动调用） |

### 8.3 五个专业子代理

| 代理                | 模式       | 角色                                                                                                                            |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **critic**        | subagent | 对抗性评估者。挑战 novelty、贡献声明、方法合理性。应用结构化测试（reduction/engineering-vs-insight/assumption/straw-man/scope/sprawl/simplicity/necessity） |
| **methodologist** | subagent | 建设性设计专家。协助方法设计、实验矩阵、baseline 选择、评估协议。**非对抗性**——与研究者协作                                                                         |
| **auditor**       | subagent | 取证诚信检查者。验证数据溯源、图-数据一致性、引用准确性、Red-Line 合规。**不评判质量**——只检查事实真实性                                                                  |
| **editor**        | subagent | 学术写作专家。审查叙事结构、论证流畅度、相关工作的公平性、技术写作质量。**审查改进**而非从零撰写                                                                            |
| **inspector**     | subagent | 代码质量审计者。检查可读性、不必要间接层、结构密度和卫生（dead code/unused imports/patch-over-fix）。**只报告问题**——不修复代码                                        |

---

## 9. 监控面板

### 9.1 后端 API 架构

基于 `Bun.serve` 的 HTTP 服务，默认端口 5174：

| Endpoint                           | 功能                     |
| ---------------------------------- | ---------------------- |
| `GET /api/health`                  | 健康检查 + 可用项目列表          |
| `GET /api/workflow`                | 当前 workflow 状态（6 阶段概览） |
| `GET /api/phase?name=X`            | 指定阶段详情                 |
| `GET /api/entities`                | 实体计数和状态分布              |
| `GET /api/timeline`                | 最近 Timeline 事件         |
| `GET /api/journal`                 | 最近 Journal 条目          |
| `GET /api/active-run`              | 当前活跃 PhaseRun 详情       |
| `GET /api/brief`                   | 自然语言研究简报               |
| `GET /api/all`                     | 聚合数据（初始加载用，含 entityRecords + checkpointBriefs） |
| `GET /api/checkpoint-briefs`       | 所有 checkpoint brief 列表 |
| `GET /api/checkpoint-brief?path=X` | 单个 checkpoint brief 内容 |
| `GET /api/invalidate-cache`        | 清除 brief 缓存            |

支持多项目切换：通过 `?project=/path/to/dir` 查询参数选择项目。未授权的项目路径返回 403 错误（不静默回退到默认项目）。

静态文件服务：非 `/api` 路径服务 React SPA，包含 `<base href>` 注入以支持代理路径。

### 9.2 前端组件树

```
App
├── ProjectSwitcher           # 多项目切换
└── WorkflowBoard
    ├── ResearchBrief         # 自然语言研究摘要（独立 polling 30s）
    ├── PhaseFlow             # 6 阶段拓扑可视化（内含 PivotRoutes）
    ├── EntitySummary         # 7 种实体计数、状态分布和 SparkArea 趋势
    ├── TimelineFeed          # Timeline 事件流
    ├── JournalFeed           # Journal 条目流
    └── PhaseDetailModal      # 阶段详情弹窗
        ├── DiagnosisLadder   # L1-L6 诊断阶梯
        └── StoryRadar        # StorySpine 雷达图
```

### 9.3 数据流和 Polling

**两个 polling hook**：

| Hook                           | 间隔  | 数据源          | 用途                                                        |
| ------------------------------ | --- | ------------ | --------------------------------------------------------- |
| `useMonitorData`               | 10s | `/api/all`   | 主数据流：workflow + entities + timeline + journal + activeRun + entityRecords |
| `useBrief` (内嵌于 ResearchBrief) | 30s | `/api/brief` | 自然语言研究摘要                                                  |

**关键特性**：

- 页面不可见时自动暂停 polling（`visibilitychange` 事件，两个 hook 均已实现）
- 请求中避免重复 fetch（`fetchInProgress` flag，两个 hook 均已实现）
- `AbortController` 在组件卸载或项目切换时取消进行中的请求
- 项目切换时保留前一个 brief 数据（`prevBriefRef`），避免空白闪烁
- 全局 CORS 头，支持远程访问

### 9.4 PhaseFlow 拓扑可视化

PhaseFlow 组件渲染 6 阶段的拓扑图，包含：

- 线性主链节点（explore → ground → design → realize → experiment → compose）
- Pivot 回边（如 experiment → design, compose → ground）
- PhaseRun 卡片（显示 round/attempts/status）
- 点击节点弹出 PhaseDetailModal

---

## 10. 文件系统布局

### 10.1 `.research/` 目录结构

```
.research/
├── state.yaml                   # 项目状态（focus, config, counters）
├── timeline.jsonl               # 全局事件流
├── ASSETS.md                    # 资源清单（models, datasets, checkpoints）
│
├── ideas/                       # Idea 实体目录
│   ├── idea_001.yaml
│   ├── idea_001.md
│   └── idea_001.reviews.jsonl
│
├── plans/                       # Plan 实体目录
│   ├── plan_001.yaml
│   ├── plan_001.md
│   └── plan_001.reviews.jsonl
│
├── experiments/                 # Experiment 实体目录
│   ├── exp_001.yaml
│   ├── exp_001.md
│   └── exp_001.reviews.jsonl
│
├── claims/                      # Claim 实体目录
│   ├── claim_001.yaml
│   ├── claim_001.md
│   └── claim_001.reviews.jsonl
│
├── exhibits/                    # Exhibit 实体目录
│   ├── exh_001.yaml
│   ├── exh_001.md
│   └── exh_001.reviews.jsonl
│
├── manuscripts/                 # Paper 实体目录
│   ├── paper_001.yaml
│   ├── paper_001.md
│   └── paper_001.reviews.jsonl
│
├── submissions/                 # Submission 实体目录
│   ├── sub_001.yaml
│   ├── sub_001.md
│   └── sub_001.reviews.jsonl
│
├── literature/                  # 文献知识库
│   ├── survey.md
│   ├── references.bib
│   ├── gap_map.yaml
│   ├── edges.jsonl
│   ├── log.jsonl
│   ├── LIT_CONTEXT.md
│   ├── by-topic/
│   └── papers/
│       └── {slug}.yaml          # 每篇论文的元数据
│
├── phase_runs/                  # PhaseRun 实例
│   └── run_{timestamp}_{rand}.yaml
│
├── journal/                     # 研究日志
│   └── journal.jsonl
│
├── snapshots/                   # 阶段快照
│   └── snap_{id}/
│       ├── manifest.yaml
│       └── ... (copied files)
│
├── positioning/                 # 贡献定位
├── code_artifacts/              # 代码制品
├── rqg/                         # RQG 报告
│   └── rqg_{id}.yaml
│
├── compose/                     # Compose 阶段产物
│   ├── confirmed_contribution.md
│   ├── results_validation.md
│   ├── reviewer_audit.md
│   ├── section_blueprints.md
│   └── writing_rationale_matrix.md
│
├── diagnoses/                   # 诊断报告
│   └── diag_{id}.yaml
│
├── checkpoint_briefs/           # Checkpoint 简报（注意：下划线命名）
│   └── brief_{id}.md
│
└── scripts/                     # 工具脚本
    ├── stats.py
    ├── plot.py
    └── paper_check.sh
```

### 10.2 项目根目录辅助文件

```
{project}/
├── .research/                   # 研究数据（核心）
├── AGENTS.md                    # 自动加载的行为规则 + 状态摘要
├── .gitignore                   # 排除大文件和构建产物
├── pyproject.toml               # Python 环境管理（uv）
└── ... (代码、数据等)
```

`AGENTS.md` 是跨 session 的持久上下文——Synergy 在每次 session 启动时自动加载它。`research_state(action="brief")` 会更新其中的动态状态区域（通过 `agentsMdMutex` 保护写入），确保即使 context 被压缩，Agent 也能快速恢复研究上下文。

---

*本文档基于 holos-research V2.1.2 源码生成，反映两轮审查（131+54 项）修复后的实际实现状态。所有描述均为已实现行为，非愿景性描述。*
