# Writing Guide — Academic Paper Narrative Strategies

This guide provides **multiple narrative strategies** for different paper types and venues. It is NOT a rigid template — choose the strategy that fits your contribution, then adapt.

## Scenario Routing (场景路由)

先确定目标 venue,再选 playbook:

| 目标 venue | 读取 |
|---|---|
| 期刊 (journal) | `references/scenario-journal.md` — 完整推导、全覆盖引用、多轮审稿视角 |
| 会议 (conference) | `references/scenario-conference.md` — 严格页限、第一页自明、附录弹药库 |
| 报告 / 综述 / 竞赛 | 本文件通用策略 + `references/scenario-*` 中适用的部分 |

场景 playbook 覆盖本文件的通用策略;两者冲突时以场景 playbook 为准。
本文件的 Section Standards 与 Venue Differences 是快速参考,具体页限/标题大小写/伦理声明以场景 playbook 和当年官方指南为准。

## Contribution Contract (贡献契约)

所有 section 的写作必须服务 `confirmed_contribution.md`(见 `references/contribution.md`):
写作前先通过 `contribution_check.py` 门禁,再按其中声明的贡献、证据边界和 Claim Boundary 写作。
Abstract 必须遵循 5 句契约(problem → gap → contribution → evidence → payoff),
Introduction 必须遵循 7 级论证阶梯(problem → progress → gap → RQ → promise → evidence preview → payoff)。
Results 每个 subsection 必须验证一个贡献承诺(见 `references/results-validation.md`)。

## Core Principle

The reader is on a journey. At every point, ask: **"Does the reader have what they need to understand the next sentence?"** If not, that is where the problem lies.

## Narrative Strategies

### Strategy A: "Problem → Mechanism → Evidence" (method papers)

Best for: Papers where the mechanism IS the contribution.

Flow: Establish problem → reveal bottleneck → present mechanism → show it works → discuss boundaries

### Strategy B: "Observation → Investigation → Insight" (analysis papers)

Best for: Papers where the main contribution is a finding or understanding.

Flow: Present surprising observation → investigate why → formalize insight → verify

### Strategy C: "Challenge → Benchmark → Evaluation" (benchmark papers)

Best for: Papers introducing datasets, benchmarks, or evaluation protocols.

Flow: Motivate inadequacy → present benchmark → evaluate methods → reveal insights

### Strategy D: "Deficiency → Fix → Proof" (theory papers)

Best for: Papers providing theoretical analysis or formal guarantees.

Flow: Identify gap → state theorem → prove → show practical implications

## Section Standards

### Abstract (150-250 words)
- Structure: Problem → Gap → Method → Key result (with number) → Broader implication (specific: what changes, for whom)
- Write LAST. No citations. No undefined acronyms.
- Must NOT overclaim relative to results.
- The final sentence must say what this result MEANS, not just what it IS. "This suggests that..." or "This enables..." — not just "We achieve X."

### Introduction (1-1.5 pages)

| ¶ | Purpose | Do NOT |
|---|---------|--------|
| 1 | Establish specific sub-problem | Start with "In recent years..." |
| 2 | What exists + why insufficient (3-5 works) | Dismiss as simply "limited" |
| 3 | The gap — what's missing | Be generic ("remains challenging") |
| 4 | Our insight — the "aha" moment | Bury in jargon |
| 5 | Contribution list (≤ 3, numbered) | Overclaim |
| 6 | Main result preview (one sentence + number) | Promise more than delivered |
| 7 | Broader impact — why this matters beyond the immediate result. Who should care? What assumption does this challenge? What capability does it unlock? What line of work does it enable? | Write generic claims ("opens new research directions"). Be specific: "This suggests that [specific implication], which means [specific community] can now [specific capability]." |

### Related Work (0.75-1 page)
- Organize by approach type, not chronologically
- Per work: what they do → their result → how we differ
- Be specific: "Prior A assumes [X], limiting [Y]"
- Include last-6-months work. Use `research_wiki(query)` data.

### Method (1.5-2 pages)
- Intuition BEFORE formalism. Every equation in words first.
- Architecture figure early. Copy from approved `plan_XXX.md`.
- Mark novel vs standard/reused components.

### Experiments (1.5-2 pages)
- Setup: datasets (stats table), baselines (cited), metrics, implementation
- Main results: lead with key finding
- Ablations: one component per row, explain what each tests
- Analysis: visualizations, diagnostics
- Every number traces to `claim_XXX` + `exp_XXX`

### Discussion / Limitations (0.5-0.75 pages)
- Honest, specific: "assumes [X], limiting [Y]"
- Reference specific failed experiments
- Concrete future work

**Discussion must include a "Broader Perspective" paragraph:**
- What assumption in the field does this work challenge or confirm? Be specific — name the assumption and cite who holds it.
- What does this enable that was previously impractical? Name the community and the capability.
- What new questions does this open? Not "future work" (that's implementation), but genuinely new research questions that arise from the findings.
- If the broader insight from the claim phase exists, this is where it gets rendered into prose.

### Conclusion (0.25-0.5 pages)
- Restate contribution (not copy-paste). Key result with number. Forward-looking.

## Venue Differences

### Page Limits

| Venue | Submission | Camera-ready | Refs | Appendix |
|-------|-----------|-------------|------|----------|
| NeurIPS | 9 pages | 10 pages | Unlimited | Unlimited |
| ICML | 8 pages | 9 pages | Unlimited | Unlimited (PDF ≤ 10MB) |
| ICLR | 9 pages | 10 pages | Unlimited | Unlimited |
| ACL (long) | 8 pages | 9 pages | Unlimited | Unlimited |
| ACL (short) | 4 pages | 5 pages | Unlimited | Unlimited |
| CVPR | 8 pages | 8 pages | Extra pages OK | Unlimited |
| AAAI | 7 pages | 7 pages | Extra pages OK | Review only (not in proceedings) |

### Heading Capitalization (critical — wrong case can look unprofessional)

| Venue | Rule | Example |
|-------|------|---------|
| NeurIPS | **Sentence case** | Methodology and results |
| ICML | Sections: **title case bold**; Subsubsections: **small caps** | *Methodology and Results* / <small>METHODOLOGY AND RESULTS</small> |
| ICLR | First-level: **small caps** | <small>METHODOLOGY AND RESULTS</small> |
| ACL/EMNLP | **Title case** | Methodology and Results |
| CVPR | **Sentence case** (same as NeurIPS) | Methodology and results |
| AAAI | **Title case** (same as ACL) | Methodology and Results |

### Caption Position

| Venue | Figures | Tables |
|-------|---------|--------|
| NeurIPS / ICML / ICLR / CVPR | Below | Above |
| ACL / AAAI | Below | Below |

### Limitations & Ethics Statements

| Venue | Limitations | Ethics | Counts toward page limit? |
|-------|------------|--------|--------------------------|
| ACL | **Required** (before refs) | Optional (before refs) | No |
| NeurIPS | Optional (encouraged) | Mandatory **checklist** (after refs) | No |
| ICLR | Not required | Optional/encouraged (before refs) | No |
| CVPR | Not required (encouraged) | IRB note if applicable | — |
| AAAI | Not required | Optional (before acknowledgments) | **Yes** (counts as content) |
| Supplementary | Unlimited | Unlimited | Extended Data (10) + SI | Limited |

**Always check the current year's style guide:**
```
websearch("[venue] [year] author instructions style guide")
```

## Writing Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| "In recent years, X has attracted..." | Start with the specific problem |
| Wall of math, no intuition | Intuition paragraph first |
| One-paragraph related work | Group by approach, 3 sentences per work |
| Buried main result | Lead with key finding |
| Generic conclusion | Insight + concrete next step |
| "significantly outperforms" (no number) | Always include specific numbers |

## Agent Workflow

```
scribe drafts section
  → editor reviews (structure, flow, clarity)
  → revise
  → critic checks (claims in text match claim objects)
  → auditor checks (numbers match experiment records)
  → final version
```
