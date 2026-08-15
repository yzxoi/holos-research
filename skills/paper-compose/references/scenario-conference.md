# Scenario Playbook — Conference(会议论文)

> 场景化 playbook 之一。目标 venue 是会议(NeurIPS/ICML/ICLR/ACL/CVPR/AAAI 等)时,用本 playbook 覆盖 writing-guide 的通用策略。期刊用 `scenario-journal.md`。

## 场景特征

| 维度 | 会议 | 影响 |
|---|---|---|
| 篇幅 | 严格页限(通常 7-9 页正文),附录另计 | 每个句子都要赚它的版面;主文只放最强的证据 |
| 审稿周期 | 数月一轮,一次定生死(顶会) | 第一印象决定命运;abstract/intro 是全部 |
| 审稿人 | 领域相近但不一定精通,可能读到附录 | 贡献必须在前两页自明;附录是弹药库 |
| 贡献类型 | 一个锐利的贡献优于三个平庸的 | "多而浅"是会议拒稿主因之一 |
| 引用 | 覆盖最近 1-2 年顶会工作即可,不必穷尽 | 漏引最近顶会工作是硬伤 |
| 回复 |  rebuttal 时间窗短,只能回应重点 | 写作时就要预判 top-2 异议(reviewer-audit) |

## 写作调整(相对通用 writing-guide)

### Abstract(150-250 词)
- 5 句契约(见 `contribution.md` Abstract checklist)是**硬约束**。会议读者只看 abstract + intro 决定是否细读。
- 第一句必须是问题/痛点,不是背景综述。
- 数字必须具体("+3.1 acc over best baseline"),不能"significantly outperforms"。

### Introduction(严格 1-1.5 页)
- 7 级论证阶梯(见 `contribution.md` Introduction checklist)每级都要在**前两页内**完成。
- 贡献列表 ≤3,每项一句话,必须与 Results 的 subsection 一一对应。
- 主结果预览必须在第 1 页出现(带数字)。
- 不要在第 1 页放公式/算法伪代码——那是 Method 的版面。

### Related Work(0.75-1 页)
- 按方法类型分组,每个工作 1-2 句:"他们做什么 → 怎么不同"。
- 必须覆盖最近 1-2 年的顶会工作——用 `research_wiki(query)` 查,漏引 = novelty 异议实锤。
- 会议的 related work 常被审稿人用来找"你没引的 closest work",Reviewer-Audit 的 novelty 响应要在这里正面处理。

### Method(1.5-2 页)
- 直觉先行,公式随后。每个设计选择绑定 `confirmed_contribution.md → Concrete challenge`。
- 架构图放 Method 开头(从 approved plan_XXX.md 拷)。
- 主文只放核心公式;详细推导、伪代码、实现细节进附录(supplementary)。

### Experiments / Results(1.5-2 页,主文最贵的地产)
- **主文只放最强证据**:头条对比表 + 核心 ablation + 1 个关键分析图。
- 每个 Results subsection 绑定一个贡献承诺(`results_validation.md`)——这是防"指标倾倒"的硬约束。
- 次要数据集、完整 ablation、超参敏感性、失败案例 → 附录。
- 页数不够时,先砍定性分析段,再压缩 ablation,最后才考虑砍实验——但砍掉的每项都进附录。

### Discussion(0.5 页)
- 会议 discussion 通常很短。机制解释 1-2 句 + 限制诚实 1 句 + future work 1 句。
- Broader Perspective 段在页数允许时保留(顶会加分),否则并入 conclusion。

## 常见会议特定要求(写作前必须查当年指南)

| Venue | 关键约束 |
|---|---|
| NeurIPS | 9 页正文;`\title` + `\maketitle` 必须;限制/伦理声明位置 |
| ICML | 8 页正文 + 1 页 camera-ready;PDF ≤ 10MB |
| ICLR | 9 页正文;natbib 引用 |
| ACL/EMNLP | 8 页(长)/4 页(短);limitations 段**必需**;title case |
| CVPR | 8 页正文;匿名评审严格 |
| AAAI | 7 页正文;**禁用 hyperref/titlesec/`\input`**;pdfLaTeX only |

> ⚠️ 每个会议每年的 style 都可能变。写作前 `websearch("[venue] [year] author instructions")`,下载当年 `.sty`/`.bst` 到 `paper/`,用 `paper_check.sh` 验证编译。

## 关卡衔接

- 硬门禁顺序不变:contribution → results_validation → reviewer_audit → blueprints → draft。
- Editorial Fit 在选定会议后填写,对照上表。
- 页数检查:`.research/scripts/paper_check.sh paper/ --limit [page_limit]` 是**硬关卡**——超页 = 拒稿理由。

## 场景快速自查

- [ ] Abstract 5 句契约:问题→gap→贡献→证据→payoff,无过度声称
- [ ] 第 1 页出现主结果预览(带数字)
- [ ] 贡献列表与 Results subsection 一一对应
- [ ] 主文只放最强证据,次要全进附录
- [ ] 引用覆盖最近 1-2 年顶会工作
- [ ] 页数 ≤ venue 限制(`paper_check.sh --limit`)
- [ ] 匿名性:无作者名、无自引暴露、无致谢(双盲)
- [ ] 当年 style 文件已下载并编译通过
