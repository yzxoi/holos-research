# Evaluation Design


## Metric Selection Protocol

### Step 1: Identify the Primary Metric

Choose the ONE metric that best captures the core contribution. This is the metric that appears in the abstract, the main results table, and the conclusion.

The primary metric must directly measure what the method claims to improve:

| Claim type | Primary metric examples |
|---|---|
| Quality improvement | Accuracy, F1, BLEU, ROUGE, BLEURT, human eval win rate |
| Efficiency improvement | Latency (ms), throughput (samples/s), FLOPs, parameter count, memory (GB) |
| Robustness improvement | Worst-group accuracy, performance variance, OOD accuracy |
| Data efficiency | Accuracy at fixed data budget, data-to-performance curve AUC |
| Alignment/safety | Win rate vs reference, refusal rate, toxicity score, reward model score |

The primary metric must be standard in your subfield. Using a non-standard primary metric makes results incomparable and raises reviewer suspicion. If the community uses accuracy, do not invent a custom composite score as the primary metric — use it as a secondary metric instead.

If no single metric captures the contribution, the contribution may be poorly defined. Refine the claim before proceeding. A method that "improves both quality and efficiency" still needs a primary metric — choose the one that matters more for the paper's thesis.

**Edge case — generative tasks without a single gold metric**: For open-ended generation (story writing, dialogue, creative text), no automated metric is fully trusted. In these cases, the primary metric is human evaluation (win rate or Likert-scale rating), with automated metrics as secondary. Budget for human evaluation early — it requires IRB approval, annotator recruitment, and inter-annotator agreement analysis.

**Edge case — multi-objective optimization**: If the method explicitly optimizes a Pareto frontier (e.g., accuracy vs. latency), the primary "metric" is the frontier itself. Report hypervolume or the accuracy-at-fixed-latency point. Do not report only one point on the frontier as the primary result.

### Step 2: Identify Secondary Metrics

Supporting metrics that provide context and preempt reviewer questions. Every secondary metric must have a justification — do not add metrics just because they are easy to compute.

**Efficiency metrics** (required if the method could be more expensive than baselines):
- Latency: wall-clock inference time per sample (ms). Report at batch size 1 and at maximum throughput batch size.
- Throughput: samples per second at optimal batch size.
- Memory: peak GPU memory during inference (GB). Report for the largest model variant.
- FLOPs: theoretical floating-point operations per inference. Less informative than wall-clock time but hardware-independent.
- Parameter count: total trainable parameters. Distinguish from total parameters if using frozen components.
- Training cost: GPU-hours to reach reported performance. Essential if the method trains longer than baselines.

**Robustness metrics** (required if the method could be brittle):
- Performance variance across random seeds: mean ± std across ≥ 3 seeds.
- Performance across subpopulations: per-group accuracy for each demographic or domain slice.
- Performance under distribution shift: OOD test set, corrupted inputs, adversarial examples.
- Sensitivity to hyperparameters: performance range across reasonable hyperparameter choices.

**Ablation metrics** (required to isolate component contributions):
- Intermediate measurements that explain why the method works: attention pattern entropy, representation alignment scores, gradient norm, mutual information between components.
- These metrics do not appear in the main results table but are essential for the ablation analysis.

**Fairness and safety metrics** (required if the task involves people or sensitive content):
- Demographic parity difference, equalized odds difference.
- Toxicity score (Perspective API or equivalent).
- Refusal rate for unsafe prompts.

**Domain-specific secondary metrics**:

| Domain | Common secondary metrics |
|---|---|
| Classification | Per-class F1, macro/micro average, AUC-ROC, calibration error (ECE) |
| Generation | BLEU-1/2/3/4, ROUGE-L, METEOR, BERTScore, BLEURT, repetition rate, diversity (distinct-n) |
| Retrieval | Recall@K, MRR, NDCG@K, precision@K |
| Detection/segmentation | mAP, IoU, precision-recall curve |
| RL | Average return, success rate, sample efficiency curve, wall-clock time |
| Speech | WER, CER, MOS, speaker similarity |
| Vision generation | FID, IS, CLIP score, human preference |

### Step 3: Metric Pitfall Check

For each chosen metric, identify known failure modes and specify mitigations.

**Accuracy on imbalanced datasets**: High accuracy can mask zero performance on minority classes. Mitigation: report per-class metrics and macro-averaged scores. If class imbalance is extreme (> 100:1), accuracy is not a valid primary metric — use macro F1 or balanced accuracy instead.

**BLEU/ROUGE for generation**: N-gram overlap metrics correlate poorly with human judgment for open-ended generation. They penalize valid paraphrases and reward degenerate repetition. Mitigation: supplement with model-based evaluation (BERTScore, BLEURT, COMET) and human evaluation. Never use BLEU as the sole metric for creative generation tasks.

**Perplexity for language models**: Lower perplexity does not guarantee better downstream performance. A model can achieve low perplexity by memorizing the training distribution while failing on rare patterns. Mitigation: validate with task-specific metrics on downstream benchmarks.

**FID for image generation**: FID is sensitive to the number of samples, the feature extractor, and preprocessing. Different implementations produce incomparable numbers. Mitigation: use the same FID implementation for all methods, report the number of samples used, and specify the feature extractor (typically InceptionV3).

**Human evaluation without inter-annotator agreement**: Human judgments without agreement metrics are not scientific evidence. Mitigation: report Krippendorff's alpha or Fleiss' kappa. If agreement is below 0.6, the evaluation protocol needs redesign.

**Single-seed reporting**: Reporting results from one random seed is not statistically valid. Mitigation: always report mean and standard deviation across multiple seeds. If computational constraints limit seeds, acknowledge this limitation explicitly.

**Test set overuse**: Tuning hyperparameters on the test set invalidates it as an unbiased estimator. Mitigation: use a strict train/validation/test split. The test set is touched exactly once, at the very end. If you need to iterate, use the validation set or cross-validation.

**Metric gaming**: Every metric can be gamed. BLEU can be maximized by generating short, repetitive outputs. Accuracy can be maximized by predicting the majority class. Mitigation: check whether the method improves the primary metric through the intended mechanism or through a degenerate shortcut. Report diagnostic metrics that would expose gaming.

**Missing baselines**: Omitting the strongest baseline makes results look better than they are. Mitigation: include the current state-of-the-art method for the task. If a baseline is excluded, justify why in the paper.

### Step 4: Statistical Rigor

Define the statistical methodology before running experiments.

**Number of seeds**:
- Minimum 3 for main results. 5+ for claims requiring high confidence.
- More seeds for smaller effect sizes. If the expected improvement is < 1 standard deviation, use ≥ 5 seeds.
- For computationally expensive experiments (e.g., LLM fine-tuning), 3 seeds may be the practical maximum. Acknowledge this limitation.
- Record all seeds used. Do not drop seeds that produce unfavorable results.

**Significance testing**:
- Specify the test before seeing results. Common choices:
  - **Paired t-test**: When comparing two methods on the same test instances. Assumes normality of differences.
  - **Bootstrap test**: When the normality assumption is violated. Resample with replacement (≥ 10,000 iterations) and compute the distribution of the difference.
  - **Permutation test**: Non-parametric alternative. Shuffle method labels and recompute the test statistic.
  - **McNemar's test**: For paired binary outcomes (correct/incorrect per instance).
- Significance level: p < 0.05 is standard. For high-stakes claims, consider p < 0.01.
- **Multiple comparison correction**: If testing multiple hypotheses (e.g., comparing against 5 baselines on 10 datasets), apply correction:
  - **Bonferroni**: Divide α by the number of tests. Conservative; use when false positives are costly.
  - **Benjamini-Hochberg**: Controls false discovery rate. Less conservative; use for exploratory analysis.
  - **Pre-registration**: If hypotheses are pre-registered (stated before experiments), correction may not be needed for those specific tests. All post-hoc tests still require correction.

**Effect size**:
- Report not just whether an improvement is statistically significant, but how large it is.
- Common effect size measures:
  - **Cohen's d**: (mean_A - mean_B) / pooled_std. Interpret: 0.2 = small, 0.5 = medium, 0.8 = large.
  - **Relative improvement**: (metric_A - metric_B) / metric_B × 100%.
  - **Absolute improvement**: metric_A - metric_B (in native units).
- A statistically significant 0.1% improvement with a tiny effect size may not be practically meaningful. Report both significance and effect size.

**Reporting format**:
- Mean ± standard deviation across seeds: "92.1 ± 0.3"
- If reporting best-of-N, explicitly state this and report the full distribution. Best-of-N is acceptable for hyperparameter tuning on the validation set but not for test set results.
- Confidence intervals: 95% CI is standard. Report as "92.1 [91.8, 92.4]" or "92.1 ± 0.3 (95% CI)".
- Do not report only the best seed. This is cherry-picking.

**Variance analysis**:
- If variance across seeds is unexpectedly large (> 2× the expected standard deviation), investigate:
  - Is the training unstable? Check loss curves for divergence.
  - Is the metric sensitive to initialization? Consider more seeds or a different metric.
  - Is there a bug in the random seed setting? Verify that different seeds actually produce different initializations.
- Report the coefficient of variation (std / mean) to quantify relative variability.

---

## Evaluation Protocol Design

### Step 5: Define the Evaluation Procedure

Document the exact steps to evaluate any method. The procedure must be detailed enough that a stranger can reproduce results without additional guidance.

**Environment specification**:
- Docker image: full image name and tag (e.g., `docker.sii.shaipower.online/inspire-studio/pytorch-2.1-cuda12:v1`).
- GPU type and count: model name (e.g., NVIDIA A100-SXM4-80GB) and number of GPUs.
- Software versions: Python, PyTorch, CUDA, and key library versions. Use `pip freeze` or `conda list` to capture the full environment.

**Data specification**:
- Dataset name, version, and source URL.
- Which split: train/validation/test. If using a custom split, document how it was created.
- Preprocessing steps: tokenization, normalization, resizing, filtering. Include exact parameters.
- Data loading code path: which script or module loads the data.

**Model specification**:
- Checkpoint path or download URL.
- Any special initialization: random seed, pre-trained weight loading, component freezing.
- Model configuration: architecture variant, hidden size, number of layers, etc.

**Inference specification**:
- Batch size: for evaluation, use the largest batch size that fits in GPU memory to minimize variance from batching effects.
- Decoding parameters (for generative models): temperature, top-k, top-p, max tokens, beam size, length penalty.
- Any post-processing: detokenization, de-escalation, filtering.

**Metric computation**:
- Exact script or function path: `python scripts/evaluate.py --predictions preds.json --references refs.json --metrics accuracy f1`.
- Metric implementation source: if using a library (e.g., `torchmetrics`, `evaluate`, `sacrebleu`), specify the version.
- Any post-processing of metric outputs: rounding, aggregation across examples, handling of edge cases (empty predictions, missing references).

**Output artifacts**:
- What files are saved: predictions file (JSON/JSONL), metrics file (JSON/YAML), log file.
- Where they are saved: relative to the project root or experiment directory.
- Naming convention: `exp_007_seed42_predictions.json`, `exp_007_seed42_metrics.json`.

**Reproducibility checklist** (verify before running):
- [ ] All random seeds are set and recorded (Python `random`, NumPy, PyTorch, CUDA).
- [ ] Data loading is deterministic (no shuffling with unset seeds).
- [ ] Evaluation code is committed to git with a recorded hash.
- [ ] The evaluation script produces identical results when run twice on the same inputs.

### Step 6: Hyperparameter Selection Protocol

How will hyperparameters be chosen for each method? Document the protocol before running experiments. Changing the protocol after seeing results is p-hacking.

**Selection methods**:

| Method | When to use | Documentation required |
|---|---|---|
| Fixed from prior work | The method is a known baseline with established hyperparameters | Cite the source. State which hyperparameters are taken from the source and which are adapted. |
| Grid search | Small search space (≤ 3 hyperparameters, ≤ 27 combinations) | Define the grid. Report the best configuration and the search range. |
| Random search | Larger search space, continuous hyperparameters | Define the distribution for each hyperparameter. Report the number of trials and the best configuration. |
| Bayesian optimization | Expensive evaluations, continuous hyperparameters | Define the search space, acquisition function, and optimization budget. Report the best configuration. |
| Validation-based selection | Any method | Which metric on which split determines the best configuration. |

**Protocol rules**:
- Hyperparameters are tuned on the validation set only. The test set is never used for hyperparameter selection.
- If the dataset has no official validation split, create one by holding out a portion of the training set (typically 10-20%). Document the split creation.
- For each baseline method, apply the same hyperparameter selection budget (same number of trials, same search space granularity). Do not give your method more tuning budget than baselines.
- If a baseline's hyperparameters are taken from prior work without re-tuning, state this. If your method is tuned and baselines are not, the comparison is unfair — acknowledge this limitation.
- Record all hyperparameter configurations tried, not just the best one. This enables later analysis of hyperparameter sensitivity.

**Fair comparison rules**:
- Use the same data preprocessing for all methods.
- Use the same evaluation code for all methods.
- Use the same computational budget for hyperparameter search across methods.
- If a baseline requires task-specific adaptation (e.g., prompt engineering for LLMs), document the adaptation protocol and apply equal effort to all methods.

### Step 7: Result Presentation Plan

Plan the tables and figures before running experiments. This prevents post-hoc selection of the most favorable presentation.

**Main results table**:

```
| Method | Dataset A | Dataset B | Dataset C | Avg |
|--------|-----------|-----------|-----------|-----|
| Baseline 1 | 85.2 ± 0.4 | 78.1 ± 0.6 | 91.3 ± 0.3 | 84.9 |
| Baseline 2 | 86.1 ± 0.3 | 79.4 ± 0.5 | 92.0 ± 0.4 | 85.8 |
| Ours | 88.3 ± 0.2 | 81.7 ± 0.4 | 93.1 ± 0.3 | 87.7 |
```

Rules:
- Rows = methods, columns = benchmarks/datasets.
- Cells = primary metric (mean ± std).
- Bold the best result in each column. If results are within one standard deviation, do not bold — the difference is not meaningful.
- Include statistical significance markers: superscript asterisks (* p < 0.05, ** p < 0.01) or a separate column.
- Include an "Average" column only if the datasets are comparable in scale and difficulty. Otherwise, report per-dataset results only.
- Order methods logically: baselines first (by publication date or strength), then ablations, then your method last.

**Ablation table**:

```
| Variant | Dataset A | Dataset B | Δ |
|---------|-----------|-----------|-----|
| Full method | 88.3 | 81.7 | — |
| − Component X | 86.1 | 79.8 | −2.2 / −1.9 |
| − Component Y | 87.5 | 80.9 | −0.8 / −0.8 |
| − Both | 85.4 | 78.2 | −2.9 / −3.5 |
```

Rules:
- Start with the full method, then remove one component at a time.
- The Δ column shows the drop from the full method. Negative values mean the component helps.
- If removing a component improves performance, investigate — the component may be harmful or the ablation may be confounded.
- Include a row with all components removed (the bare backbone) to show the total contribution.

**Efficiency-quality trade-off figure**:
- Scatter plot with efficiency on x-axis (latency, FLOPs, or memory), quality on y-axis (primary metric).
- One point per method. Your method should be in the upper-left quadrant (better quality, lower cost).
- If your method is not Pareto-optimal, acknowledge this. Do not hide it by choosing a favorable axis range.
- Include error bars on both axes if variance data is available.

**Training curves**:
- Plot primary metric (y-axis) vs. training steps or wall-clock time (x-axis).
- Show all methods on the same plot. Your method should converge faster or to a better final value.
- If your method converges slower but to a better final value, this is a legitimate trade-off — report it honestly.
- Use log scale for the x-axis if convergence happens at different rates.

**Case studies or qualitative examples**:
- Plan which examples to show and what they illustrate before running experiments.
- Select examples that are representative, not cherry-picked. Define the selection criteria: "randomly sampled from the test set" or "examples where all methods disagree."
- If showing failure cases, show failures for all methods, not just baselines.
- Each qualitative example should illustrate a specific claim from the validation sketch.

**Result presentation checklist**:
- [ ] Every number in a table traces to an experiment record.
- [ ] Standard deviations are reported for all main results.
- [ ] Statistical significance is marked.
- [ ] The best result is bolded (only if meaningfully better).
- [ ] Axes are labeled with units.
- [ ] Figure captions are self-contained.
- [ ] Color is not the sole distinguishing feature.

---

## Common Pitfalls

**Choosing metrics after seeing results**: Deciding to report F1 instead of accuracy because F1 looks better. Metrics must be chosen before experiments. If you discover post-hoc that a different metric better captures the contribution, you may add it as a secondary metric but the primary metric must remain as originally specified.

**Ignoring variance**: Reporting a single number without error bars. All empirical results have variance — hiding it is dishonest. If variance is genuinely negligible (std < 0.1% of mean), state this explicitly rather than omitting it.

**Multiple comparisons without correction**: Running 20 significance tests and reporting the one that passes. Apply correction or pre-register hypotheses. If you did not pre-register, apply Benjamini-Hochberg to all tests and report both raw and corrected p-values.

**Inconsistent evaluation across methods**: Using different evaluation scripts or metric implementations for different methods. Use identical evaluation code for all methods. If a baseline's official implementation uses a different metric computation, run both the official and your unified evaluation, and report both.

**Not documenting evaluation code**: If the evaluation script is not version-controlled, results cannot be reproduced or audited. Commit the evaluation script to git and record the commit hash in the experiment record.

**Test set leakage**: Using the test set for anything other than the final evaluation. This includes: hyperparameter tuning, early stopping, model selection, feature selection, and qualitative example selection. If you need to make decisions during development, use the validation set.

**Comparing against weak baselines**: Omitting the current state-of-the-art or using a weak version of a strong baseline. Include the strongest published baseline. If you cannot reproduce a published baseline's results, report both your reproduction and the published number, and discuss the discrepancy.

**Overclaiming from small improvements**: Claiming superiority based on a 0.3% improvement that is within one standard deviation. If the improvement is not statistically significant and practically meaningful, do not claim superiority. Use language like "comparable performance" or "competitive with."

**Hiding negative results**: Not reporting experiments where the method performed poorly. Negative results are valuable — they define the method's limitations and guide future work. Report them in the ablation section or appendix.

**Ignoring computational cost**: Claiming a method is "better" when it requires 10× more compute than baselines. If your method is more expensive, report the cost and justify the trade-off. An efficiency-quality trade-off figure makes this transparent.

---

## Evaluation Documentation Template

Insert this block into the plan `.md` under the "Claim-Driven Validation Sketch" section. Fill in all fields before running experiments.

```markdown
### Evaluation Protocol

**Primary metric**: [metric name]
- Justification: [why this metric captures the core contribution]
- Standard in subfield: [cite 2-3 papers that use this metric as primary]

**Secondary metrics**:
- [metric name]: [justification for inclusion]
- [metric name]: [justification for inclusion]

**Statistical methodology**:
- Seeds: [number] seeds per experiment
- Reporting format: mean ± std across seeds
- Significance test: [test type], p < [threshold]
- Multiple comparison correction: [method or "not applicable — single hypothesis"]
- Effect size measure: [Cohen's d / relative improvement / absolute improvement]

**Hyperparameter selection**:
- Protocol: [grid search / random search / Bayesian optimization / fixed from prior work]
- Search budget: [number of trials] per method
- Selection criterion: [metric] on [validation split]
- Fairness: [how equal tuning budget is ensured across methods]

**Evaluation procedure**:
1. Environment: [Docker image, GPU type, software versions]
2. Data: [dataset, split, preprocessing]
3. Model: [checkpoint, initialization]
4. Inference: [batch size, decoding parameters]
5. Metric computation: [script path, library version]
6. Output: [file paths and formats]

**Result presentation**:
- Main table: [rows × columns structure]
- Ablation table: [variants to compare]
- Trade-off figure: [efficiency vs. quality scatter plot]
- Training curves: [methods to plot]
- Qualitative examples: [selection criteria, number of examples]
```
