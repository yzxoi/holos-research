# Results-as-Validation — 结果验证矩阵(防 metric dump)

> 参考 PaperSpine V4 results-validation 规则,适配 holos-research 对象模型。

Results 不是指标倾倒。每个主要 Results subsection 存在的意义是**检验论文做出的一个承诺**——Abstract 或 Introduction 里的一个贡献声明——并诚实地确认或否定它。如果 Results 里出现一个数字却不映射到任何贡献,读者无法判断论文是否兑现了广告。这个空洞正是审稿人说"实验不支持声明"的地方。

`results_validation.md` 强制在写 Results 散文**之前**显式建立映射,让每个 subsection 出生时就绑定了声明、证据位置和解释边界。

## 核心规则

> 每个主要 Results subsection 必须验证**至少一个贡献承诺**。一个报告指标但没有贡献映射的行是失败,不是风格偏好——`results_validation_check.py` 拒绝任何 `Contribution Claim Tested` 或 `Result/Evidence` 单元格为空的行。

这是写作阶段最锋利的约束:它把"我们跑了实验"变成"我们证明了声称的每件事"。如果一个贡献没有行,要么你忘了测它,要么声明不受支持——两者都必须在论文诚实之前修复。

## 必需表格

写入 `.research/compose/results_validation.md`:

| Results Unit | Contribution Claim Tested | Result/Evidence | Figure/Table | Confirmatory Condition | Allowed Interpretation | Interpretation NOT Allowed |
|---|---|---|---|---|---|---|
| 4.2 Main accuracy vs. SOTA | C1: our method beats prior SOTA on benchmark X | +3.1 acc over best baseline (88.4 vs 85.3) | Table 2 | Holds only on X's standard split; same backbone, same epochs | Method improves accuracy under matched-budget training on X | Do NOT claim general superiority on unseen domains or larger budgets |
| 4.3 Ablation of module M | C2: module M is the source of the gain | Removing M drops acc 88.4 to 85.9 | Table 3 | Single dataset, single seed-averaged run | M contributes the majority of the C1 gain | Do NOT claim M is necessary for other architectures |
| 4.4 Efficiency | C3: method is cheaper at inference | 1.7x fewer FLOPs at equal accuracy | Fig. 4 | Measured on one GPU, batch=1 | Lower inference cost at matched accuracy | Do NOT claim training-time savings (not measured) |

## 每列为什么存在

- **Results Unit** — 实际 subsection 标题/编号。把行锚定到稿件的真实位置,让审稿人(和检查)能确认 subsection 存在且配得上它的空间。
- **Contribution Claim Tested** — 具体承诺(标 C1、C2…以匹配 Introduction 的贡献列表)。WHY:这一列把指标变成验证。这里为空意味着实验什么都没验证——硬失败。
- **Result/Evidence** — 解决声明的具体数字、delta 或定性发现。WHY:迫使你点名证据,而不是比划。为空意味着 subsection 背后没有结果——硬失败。
- **Figure/Table** — 读者在哪里看到它(Table 2、Fig. 4)。WHY:未锚定的声明无法验证;每个确认的承诺必须指向可见产物。
- **Confirmatory Condition** — 结果成立的确切 regime(哪个 split、预算、seed 数、硬件)。WHY:结果只在*其条件内*是证据;陈述条件是阻止过度泛化的东西。
- **Allowed Interpretation** — 证据支持的最强诚实解读。WHY:写出你被授权说的声称句。
- **Interpretation NOT Allowed** — 这一行**不**授权的诱人过度声称。WHY:预先承诺边界,让 Discussion 不能悄悄膨胀结果。审稿人奖励自我约束范围的论文。

## 如何构建

1. 列出 Abstract/Introduction 的每个贡献(C1、C2…)。
2. 对每个贡献,找到或设计检验它的 Results subsection。每个贡献至少需要一行。
3. 对每个主要 Results subsection 填行。如果 subsection 无法映射到任何贡献,它要么是填充(删掉),要么是未宣布的贡献(加进 Introduction)。
4. 填 confirmatory condition 和两个 interpretation 列。interpretation 列为空是 warning 不是失败——但空的 `Interpretation NOT Allowed` 是"过度声称"投诉最常见的单一原因,填它。

## 与对象模型对齐

- `Results Unit` 应能定位到 `paper/` 中的真实 section 标题(写作后用)。
- `Contribution Claim Tested` 的 C1/C2 应与 `confirmed_contribution.md` 的 contribution 列表一致。
- `Result/Evidence` 的数字应能从 `research_experiment` 的 metrics 复现——这是 `numeric_consistency_check.py` 检查论文数字与实验记录一致性的输入。
- `Figure/Table` 应指向已注册的 `research_exhibit`(label)。

## 失败模式(检查脚本抓的)

- **Metric-only row** — 有数字但 `Contribution Claim Tested` 为空。经典"我报告准确率因为我能"。硬失败。
- **Empty evidence** — 声明没有 `Result/Evidence`。背后没东西的承诺。硬失败。
- **Missing file or no data rows** — 验证步骤整体被跳过。硬失败。
- **Empty interpretation columns** — 只 warning,但提交前修掉。

## 输出位置

```text
.research/compose/results_validation.md
```

只要论文有 Results/Experiments section,必须在最终写作前生成。验证:

```text
python .research/scripts/results_validation_check.py .research/compose/ --json
```

Exit 0 = 每个 Results subsection 验证一个承诺。Exit 1 = 至少一个 subsection 报告了证明不了任何东西的指标。

## 与 contribution 门禁的衔接

先有 `confirmed_contribution.md`(已通过 `contribution_check.py`),再建本矩阵——C1/C2 列表从贡献声明来。两者都通过后才进入 section blueprints 与正文写作。
