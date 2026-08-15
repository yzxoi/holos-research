# Contribution-First — 贡献契约前置(写作前硬门禁)

> 参考 PaperSpine V4 contribution-first 规则,适配 holos-research 对象模型。
> 一篇论文被接受或拒绝,取决于它的**贡献**——一个可辩护的、审稿人能接受或拒绝的承诺——而不是文笔多流畅。动机解释"读者为什么在乎",贡献声明"这篇论文到底交付了什么、愿意被怎样评判"。两者不是一回事,动机不能替代贡献。

## 硬规则

> **没有通过 `contribution_check.py` 的 `confirmed_contribution.md`,不得开始任何正文写作。**

具体地:

1. `.research/compose/confirmed_contribution.md` 必须存在且通过检查,**先于** section blueprint、写作 rationale matrix 和任何正文草稿。
2. 每个后续产物(section blueprints、writing rationale matrix、正文)必须能追溯到这里的单一 Core contribution 声明。一个段落如果不推进、不支持、或不定界这个声明,它就不属于这篇论文。
3. 所有字段必须与结构化对象对齐:
   - `Main contribution statement` → 应有对应的 `research_claim`(claim 的 statement 字段)
   - `Evidence available` → 应有对应的 `research_experiment`(metrics)和 `research_exhibit`(figure/table)
   - `Claim boundary` → 应对应 claim 的 caveats
4. 贡献声明变化时,重跑检查;漂移会使下游所有 section 失效。

WHY 这是硬门禁:生成论文最常见的失败模式是"每句话都流畅,却从未承诺一个审稿人可接受或可拒绝的声明"。强制先把贡献写下来、打出来、定好边界,整篇论文才对得一个可检验的承诺。

## 产物:`confirmed_contribution.md`

保存到 `.research/compose/confirmed_contribution.md`。四个必需 section,每个字段的 WHY 说明省略字段时会出什么问题。不要留 `TODO` / `TBD` / `...` 占位符——`contribution_check.py` 把它们当失败。

```markdown
# Confirmed Contribution

## Core Contribution

| Field | Content |
|---|---|
| Main contribution statement | 整篇论文捍卫的单一句话。一个声明,具体,可证伪。对应 claim_XXX.statement。 |
| Contribution type | new method / new dataset / new theory / new empirical finding / new system / new analysis-or-benchmark / new application。选主导类型。 |
| One-sentence reviewer payoff | 审稿人只记得一件事,就是它。措辞为对领域的价值,不是做了什么活动。 |

## Why This Contribution Is Needed

| Field | Content |
|---|---|
| Field problem | 领域普遍关心的问题。为什么这个领域存在。 |
| Specific gap | 这篇论文填补的精确缺失能力/知识。不是"X 研究不足"——点名确切空洞。 |
| Concrete challenge | 为什么这个空洞难填(解释它至今仍开放的技术/实证障碍)。 |
| Why prior work leaves it unresolved | 点名最近的 prior approaches,以及每个为什么不能解决这个空洞。对应 wiki edges。 |

## How This Paper Responds

| Field | Content |
|---|---|
| Design response | 解决空洞的核心想法/机制。"怎么做",直接绑定上面的 challenge。对应 plan_XXX 的 method 设计。 |
| Evidence required | 一个怀疑的审稿人会要求什么证据才相信 Core contribution。在盘点你有什么之前先列出来。 |
| Evidence available | 你实际有的证据(exp_XXX metrics、exh_XXX、proofs、datasets、ablations),满足 required 清单的部分。 |
| Evidence missing | required 与 available 的差距。若非空,Core contribution 必须软化或需要更多工作。诚实的条目防止过度声称。 |

## Claim Boundary

| Field | Content |
|---|---|
| Strong claims allowed | Evidence available 完全支撑的声明。以完整强度陈述。 |
| Claims to soften or avoid | 证据扛不住的声明。加限定("suggests"、"in this setting")或删掉。 |
| Novelty risk | 最可能的"这已经被 X 做过"异议,以及你的诚实回答。 |
| Significance risk | 最可能的"so what / 太窄"异议,以及你的诚实回答。 |
```

WHY 四段按此顺序:贡献只有当它**被需要**(section 2)、**用证据回答**(section 3)、**定界不越权**(section 4)时才真实。Section 1 是承诺;2-4 是让承诺经得起审稿的东西。`Evidence missing` 和 `Claim boundary` 是作者跳过、审稿人惩罚的部分——本 skill 强制。

## 检查清单(每个 section 的写作门禁)

这些是清单,不是额外产物:每一项都应能追溯到 `confirmed_contribution.md` 的一个字段。

### CHECKLIST — Introduction 论证阶梯

Introduction 是贡献的论证,按阶梯铺开。每级向声明收窄;跳级是"读着还行但什么都没说"的最常见原因。

- [ ] **Problem** — 建立领域问题(`Why This Contribution Is Needed → Field problem`)。
- [ ] **Progress** — 已有工作已取得什么。要公平;这是空洞可信的原因。
- [ ] **Gap** — 留下的具体空洞(`→ Specific gap`)加保持其开放的 concrete challenge。整个 intro 的枢纽。
- [ ] **RQ** — 把空洞变成论文要回答的精确研究问题/目标。
- [ ] **Contribution promise** — 以论文对 RQ 的回答陈述 Core contribution(`Core Contribution → Main contribution statement`)。
- [ ] **Evidence preview** — 点名支撑承诺的证据(`How This Paper Responds → Evidence available`),承诺不能裸奔。
- [ ] **Reader payoff** — 以 reviewer payoff 收尾(`Core Contribution → One-sentence reviewer payoff`)。

WHY 阶梯:每级必须是下一级的必要前提。如果 gap 不来自 progress,或 RQ 不来自 gap,贡献无论文笔多好都显得动机不足。

### CHECKLIST — Method 可信度

Methods 不只是描述;它让 Design response *可信*。每个设计选择都应回答"为什么是这个而不是显而易见的替代"。

- [ ] 每个主要设计选择映射到它克服的 `Concrete challenge`(不是"我们用了 X"而是"用 X 因为 challenge 是 Y")。
- [ ] 输入、架构/推导、目标各自被正当化,而不只是陈述。
- [ ] 评估设计(splits、baselines、metrics)被选为精确产生 `Evidence required`,而不是方便什么选什么。
- [ ] 可复现性承重细节在场(settings、data provenance、hyperparameters),审稿人不能以"无法验证" dismiss。
- [ ] Methods 里没有任何东西悄悄假设 `Claims to soften or avoid` 下的声明。

### CHECKLIST — Results 作为验证

Results 不是指标倾倒;是贡献受审的法庭。每个 subsection 验证一个承诺。详见 `references/results-validation.md` 与 `results_validation_check.py`。

- [ ] 每个 Results subsection 映射到 `Evidence required` 的一项,并测试 Introduction 的一个承诺。
- [ ] 每个 subsection 陈述:问题 → 证据(figure/metric)→ 比较 → 解释 → 它证明/不证明什么。
- [ ] 头条结果以 `Strong claims allowed` 声称的强度直接支撑 `Main contribution statement`。
- [ ] `Evidence missing` 里的任何东西在这里**明显不被声称**。没有从"suggests"静默升级到"proves"。

每个 Results subsection 起草前先写指针句:

```text
This subsection tests the contribution promise that [promise] by showing [evidence],
which supports [claim at allowed strength] but does not claim more than [boundary].
```

### CHECKLIST — Discussion 洞察与机制

Discussion 把结果变成*理解*。弱 discussion 复述数字;强的解释机制、放置贡献。

- [ ] 复述答案(贡献),不是过程。
- [ ] 解释**机制**:为什么 design response 产生了这个结果——洞察,不只是 outcome。
- [ ] 归因效应:每个关键设计选择贡献了什么(接回 Method credibility)。
- [ ] 对照 `Why prior work leaves it unresolved` 点名的先前工作定位——展示空洞现在已闭合。
- [ ] 从 `Evidence missing` / `Claim boundary` 陈述限制,不溶解核心声明。
- [ ] 以回答了 `Significance risk` 收尾:领域层面的含义,不是泛泛的"这很有用"。

### CHECKLIST — Abstract 贡献契约(5 句)

Abstract 是契约:按顺序承诺论文交付的贡献。五句话,五个任务。

1. **Problem + stakes** — 领域问题及重要性(`Field problem`)。
2. **Gap** — 具体未解空洞(`Specific gap` + 为什么 prior work 不够)。
3. **Contribution** — 作为回应的 Core contribution(`Main contribution statement` + `Design response`)。
4. **Evidence** — 最强支撑结果(`Evidence available`),以允许的强度陈述。
5. **Payoff** — reviewer payoff / 领域含义(`One-sentence reviewer payoff`),定界不越权。

WHY 契约:如果 abstract 承诺超过 `Strong claims allowed`,论文第一行就已经过度声称了。Abstract 必须能逐字段对照 `confirmed_contribution.md` 检查。

## 使用方法

1. 起草 `confirmed_contribution.md`,填满四个 section;锁定 Core statement 前诚实解决 `Evidence missing`。
2. 运行 `python .research/scripts/contribution_check.py .research/compose/` 直到 exit 0。
3. 只有在这之后才进入 section blueprints、writing rationale matrix 和写作——每一项都追溯到 Core contribution。
4. 每次声明或证据变化时重跑检查;贡献漂移会使下游 section 失效。
