# Reviewer-Audit — 审稿人预演(写作前 objection 登记)

> 参考 PaperSpine V4 reviewer-audit 规则,适配 holos-research 对象模型与 agents。

在宣称"可以投稿"之前,先把审稿人会怎么攻击这篇论文预演一遍。`reviewer_audit.md` 是审稿人价值图 + objection 登记册 + 编辑适配度,写作前就建立,写作中持续更新。

## 为什么在写作前做

- 审稿人异议是**可预测的**。Novelty("这已被 X 做过")、significance("so what")、evidence("实验不支持声明")、reproducibility("无法验证")——四类异议占了绝大多数拒稿理由。
- 在写 Introduction 之前知道 Novelty 异议,你会在 gap 阶梯里正面处理它;在写 Results 之前知道 evidence 异议,你会把 subsection 钉在贡献上(配合 results-validation 矩阵)。
- 事后补 objection 登记只是记录;事前建立才能改变写作。

## 产物:`reviewer_audit.md`

保存到 `.research/compose/reviewer_audit.md`:

```markdown
# Reviewer Audit

## Reviewer Value Map

| Reviewer Role | What They Value | What They Attack | Our Defense |
|---|---|---|---|
| reviewer-method (methodology) | 机制合理性、设计选择正当性 | "为什么是这个而不是明显替代" | 指向 confirmed_contribution → Concrete challenge |
| reviewer-evidence (empirics) | 证据强度、基线公平、统计有效性 | "实验不支持声明"、"基线不公平" | 指向 results_validation 矩阵的 Confirmatory Condition |
| reviewer-writing (clarity) | 叙事清晰、贡献可识别 | "贡献不清晰"、"过度声称" | 指向 contribution → Claim Boundary |

## Objection Register

| # | Objection (审稿人最可能说什么) | Severity | Where It Hits | Our Response / Planned Defense | Status |
|---|---|---|---|---|---|
| 1 | "The contribution is incremental over [X]" | high | Introduction gap | 在 gap 阶梯中明确 X 不能解决空洞的 reason | planned |
| 2 | "The gains are within noise" | high | Results 4.2 | 多个 seeds + 显著性;Confirmatory Condition 明确 regime | planned |
| 3 | "Baselines are unfair / not tuned" | medium | Experiments setup | 报告 baseline 调参预算;代码/配置公开 | planned |
| 4 | ... | ... | ... | ... | ... |

## Editorial Fit

| Question | Answer |
|---|---|
| 目标 venue 的读者期待什么贡献类型? | ... |
| 论文的 Contribution type 与 venue 主流是否匹配? | ... |
| 哪些 venue 特定规范可能被审稿人拿来说事?(页数、伦理声明、匿名性) | ... |
```

## 如何建立

1. **跑三个审稿人视角**(复用 holos-research agents):
   - `reviewer-method`:审方法——机制、设计选择、与 prior work 的区分。
   - `reviewer-evidence`:审证据——数字、基线、统计、可复现性。
   - `reviewer-writing`:审写作——贡献清晰度、叙事、过度声称。
   每个 agent 输入:`confirmed_contribution.md` + `results_validation.md` + 方法设计(plan_XXX.md),输出最可能的 3-5 条 objection,按严重度排序。

2. **登记 objection** 到 Objection Register,每条标注:打在哪里、我们的 planned defense、状态(planned / addressed / resolved)。

3. **每条 objection 都要有响应**。响应不是辩护词,是写作计划:"在 Introduction 第 2 段正面处理 X"、"在 Results 4.2 加显著性报告"、"在 Experiments setup 公开基线调参预算"。Status 在写作推进中从 planned → addressed → resolved。

4. **Editorial Fit** 在确定 venue 后填写(来自 scenario-journal / scenario-conference playbook)。

## 检查(轻量)

`compose_progress_check.py` 只检查文件存在。质量由 agent 自查:

- [ ] Objection Register 至少 4 条,其中至少 1 条 high severity novelty 异议、1 条 high severity evidence 异议
- [ ] 每条 objection 有非空的 planned defense
- [ ] Status 不是全部 planned——写作完成后至少 high severity 项达到 addressed 或 resolved
- [ ] 每条 defense 都能指向论文中的具体位置(section / subsection / 表格)

## 与贡献契约的衔接

- Novelty 异议的响应直接来自 `confirmed_contribution.md → Why prior work leaves it unresolved`。
- Evidence 异议的响应来自 `results_validation.md` 的 Confirmatory Condition 与 Allowed Interpretation。
- 如果某个 objection 找不到诚实响应,它就是一个**真实的弱点**——在写作前发现它,比审稿人发现它好。要么软化贡献(改 `confirmed_contribution.md`),要么补证据(回 experiment 阶段)。
