# Scenario Playbook — Journal(期刊论文)

> 场景化 playbook 之一。目标 venue 是期刊时,用本 playbook 覆盖 writing-guide 的通用策略。目标 venue 是会议时用 `scenario-conference.md`;报告/综述用 writing-guide 通用策略。

## 场景特征

| 维度 | 期刊 | 影响 |
|---|---|---|
| 篇幅 | 通常无严格页限,但要求"完整" | 可容纳更完整的推导、更多实验、更充分的 related work |
| 审稿周期 | 数月到一年+,多轮 | 写作要面向"被反复阅读",结构冗余容忍度低 |
| 审稿人 | 领域专家,可能 2-4 人,常有一轮 major revision | objection 预演(reviewer-audit)价值最高 |
| 贡献类型 | 偏向完整方法/理论/系统性实证 | 单个贡献可以做得深,不必"多而浅" |
| 引用 | 要求覆盖全面,常要求引全最近相关工作 | 引用充分性是明确评审标准 |
| 回复 | 需要逐条 response letter | 写作时就该为每条 objection 留好弹药 |

## 写作调整(相对通用 writing-guide)

### Abstract
- 期刊 abstract 通常 150-250 词,可以比会议多一句背景。
- 必须承诺"完整贡献":方法 + 理论(如有)+ 主要实证,全部在 abstract 出现。

### Introduction
- 阶梯可以更宽:允许更多进度铺垫(期刊读者可能跨子领域)。
- Gap 必须对照**最全**的 prior work 清单——期刊审稿人会查你漏引。
- 贡献列表(≤3)每个都要在正文有独立、完整的支撑段。

### Related Work
- 期刊允许 1-2 页。按方法类型分组,每组"他们做了什么 → 结果 → 我们怎么不同"。
- 覆盖最近 12 个月的工作(不只是 6 个月)。用 `research_wiki(query)`。
- 明确标注"本工作区别于 X 的地方"——这是 novelty objection 的正面战场。

### Method
- 允许完整推导,但保持"直觉先行":每个 formalism 前先有 intuition 段。
- 每个设计选择回答"为什么是这个而不是替代"(接 contribution.md Method checklist)。

### Experiments / Results
- 期刊期望:多数据集、多 baseline、完整 ablation、消融每个组件、统计显著性。
- 每个 Results subsection 绑定一个贡献承诺(`results_validation.md`)。
- 允许更长的定性分析段——期刊读者接受"为什么有效"的深度讨论。

### Discussion
- 期刊的 Discussion 是独立价值单元,不是凑字数。机制解释 + 失败案例分析 + 限制的诚实边界。
- 与 prior work 的机制对比(不是只比数字)。
- Broader Perspective 段:挑战什么假设、开启什么新问题。

## 常见期刊特定要求(写作前必须查当年指南)

| 项目 | 动作 |
|---|---|
| 页数/字数限制 | 查 target journal 的 author guidelines(websearch) |
| 图表数量上限 | 有些期刊限主文图表数,多的进 supplementary |
| Ethics / Data availability 声明 | 多数期刊要求;写作时预留位置 |
| 匿名性 | 双盲期刊:无作者名、无自引暴露 |
| 参考文献格式 | 期刊用特定 bst/样式;用 `research_wiki(verify_bib)` 校验 |

## 关卡衔接

- 本 playbook 不改变硬门禁顺序:contribution → results_validation → reviewer_audit → blueprints → draft。
- Editorial Fit(reviewer_audit.md 第三段)在选定期刊后填写,对照上表。
- 页数检查用 `.research/scripts/paper_check.sh paper/ --limit [pages]`(期刊无严格页限时用 `--limit 0` 跳过或设软上限)。

## 场景快速自查

- [ ] 引用覆盖最近 12 个月,无已知漏引
- [ ] 每个贡献有完整支撑段(不只一句话)
- [ ] 多数据集/多 baseline/完整 ablation 齐备
- [ ] 统计显著性在 Results 报告
- [ ] 期刊要求的声明(Ethics / Data availability)已预留
- [ ] 双盲匿名性满足
