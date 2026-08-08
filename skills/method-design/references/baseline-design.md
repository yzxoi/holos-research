# Baseline Design


## Baseline Selection Protocol

### Step 1: Identify Approach Categories

Map the research landscape into approach categories. Every major category must be represented by at least one baseline. A missing category is a gap in the evidence — reviewers will identify it and question whether your method actually outperforms that family of approaches.

#### 1.1 Dispatch Scholar for Landscape Mapping

Use `mcp__scholight__search_papers` for discovery (replaces the legacy arXiv search): focused natural-language query per approach family, `strength: "thorough"`, `limit: 10`, `date_from`/`date_to` for the 2023-2026 window. Fall back to websearch/webfetch on arxiv.org or the arXiv search tool only if scholight is unavailable.

```
task(subagent_type="scholar", background=true,
  "For the task of [task description], identify the major approach categories
   and the strongest method in each category.
   Use mcp__scholight__search_papers (strength='thorough', limit=10, date_from/date_to
   for 2023-2026).

   For each category, return:
   - Category name and key idea (one sentence)
   - Representative method: paper title, authors, year, venue
   - Why this is the strongest method in this category (most cited, SOTA results,
     or most principled approach)
   - Whether code is publicly available (repo URL or 'none')
   - Whether the method has been validated on the same datasets/benchmarks
     we plan to use

   Also identify:
   - Are there any emerging categories from 2025-2026 that should be included?
   - Are there any categories that were dominant 3-5 years ago but have been
     superseded? (These may still need inclusion if they represent a distinct
     approach family.)
   - Are there any 'obvious' baselines that every paper in this area includes?
     (Missing these is a red flag even if they are not the strongest.)

   For important papers (core relevance):
   1. Call research_wiki(action='ingest_paper', title='...', authors=[...],
      year=..., venue='...', arxiv='...', thesis='...', method='...',
      key_results='...', limitations='...', project_relevance='...')
   2. Download PDF via arxiv_download to .research/literature/papers/{arxiv_id}.pdf

   For minor papers: return title/arxiv/venue as text; main agent decides whether to ingest.")
```

#### 1.2 Validate Category Coverage

After the scholar returns, verify category coverage against the idea's positioning from novelty-ground. Cross-reference the related work table in the idea `.md` — any approach family mentioned there must appear in the baseline categories.

If the scholar missed a category that appears in the idea's positioning, dispatch a targeted follow-up:

```
task(subagent_type="scholar", background=true,
  "The following approach category was identified in our novelty-ground analysis
   but was not covered by the initial landscape survey: [category name].

   Find the strongest method in this category. Same format as before.")
```

#### 1.3 Handle Edge Cases in Category Identification

**Truly novel problem with no established baselines.** If the problem is genuinely new and no prior methods exist, identify the closest proxy baselines — methods designed for adjacent problems that could be adapted. Document why direct baselines do not exist and why the proxy baselines are the fairest comparison. Do not claim "no baselines exist" without exhausting proxy options.

**Overlapping categories.** If two categories blur together (e.g., "retrieval-augmented" and "memory-augmented" may overlap), decide whether to treat them as one category (with the strongest method from either) or as two (with one baseline each). The decision criterion: do the categories differ in mechanism, or only in naming? If the mechanisms are genuinely distinct, keep them separate. If they differ only in terminology, merge them and document the merge.

**Dominant category with many strong methods.** If one category contains 5+ strong methods, select the single strongest. Do not include multiple baselines from the same category unless they represent genuinely different sub-approaches within that category (e.g., sparse attention includes both fixed-pattern and learned-pattern methods). If including sub-approach baselines, justify each one.

**Proprietary or closed-source baselines.** If the strongest method in a category is proprietary (GPT-4, Gemini, Claude, etc.), include it if API access is available and the comparison is meaningful. Document the API version, date of access, and any prompt engineering methodology. If API access is not available, select the strongest open-source alternative and document the substitution.

### Step 2: Select Baselines Per Category

For each approach category, select the strongest representative. Apply these criteria in order.

#### 2.1 Primary Selection Criteria

**Code availability.** Prefer methods with publicly available, well-maintained code. Reimplementation introduces risk of unfair comparison — a buggy reimplementation makes your method look artificially strong, and reviewers will catch this. Check the repository for:
- Recent commits (active maintenance)
- Documentation (README with setup instructions)
- Issue tracker activity (signs of community use)
- License (permissive licenses preferred; restrictive licenses may limit use)

**Result strength.** Prefer the strongest published configuration of each baseline. Using a weak configuration of a strong baseline is misleading. If a baseline paper reports multiple configurations, use the one that achieves the best results on the most relevant benchmark. If the paper reports results with and without additional techniques (ensembling, data augmentation, model scaling), use the configuration that represents the core method, not the augmented version — unless the augmented version is the standard comparison in the literature.

**Recency.** Prefer methods from 2023-2026. Comparing only against 2020 baselines when 2025 methods exist is a red flag. However, do not exclude older methods if they remain the strongest in their category — some categories have not seen meaningful progress. Document the recency justification for each baseline.

**Benchmark alignment.** Prefer methods that have been evaluated on the same datasets and metrics you plan to use. If a baseline has only been evaluated on Dataset A and you plan to use Dataset B, you will need to re-evaluate it on Dataset B — factor this into the compute budget.

#### 2.2 Handling Unavailable Code

If the strongest method in a category has no public code, follow this decision tree:

1. **Can you reimplement it?** Assess the paper's method description. Is it detailed enough to reproduce? Are there architecture diagrams, pseudocode, or appendix details? If yes, proceed to reimplementation with reproduction validation (Step 4).

2. **Is there a third-party reimplementation?** Search GitHub for unofficial implementations. Check stars, forks, and issue activity. Prefer implementations that report reproduction accuracy against published numbers. If using a third-party implementation, document the source and validate reproduction.

3. **Is there a strong alternative with available code?** Select the strongest method in the same category that has public code. Document the substitution: "We compare against [Method B] instead of [Method A] because [Method A] has no public code and reimplementation is infeasible due to [reason]. [Method B] is the strongest available alternative in this category."

4. **None of the above.** If no method in the category has code and reimplementation is infeasible, document the gap explicitly: "The [category] approach family is not represented in our experiments because no method in this category has publicly available code and reimplementation is beyond our scope. This is a limitation of our empirical evaluation."

#### 2.3 Baseline Count Guidelines

Aim for 4-8 baselines total. Fewer than 4 suggests insufficient coverage of the approach landscape. More than 8 suggests bloat — some baselines are likely redundant or from marginal categories.

The baseline count should reflect the maturity of the field:
- **Mature field** (50+ papers, established benchmarks): 6-8 baselines
- **Active field** (20-50 papers, converging benchmarks): 5-7 baselines
- **Emerging field** (10-20 papers, no standard benchmark): 4-6 baselines
- **Nascent field** (< 10 papers): 3-5 baselines, plus proxy baselines from adjacent fields

#### 2.4 Special Baseline Types

**Simple/trivial baselines.** Include at least one simple baseline that establishes the performance floor. Examples: random, majority-class, zero-shot, or a minimal heuristic. This calibrates the difficulty of the task and prevents overclaiming — if your method barely outperforms a trivial baseline, the contribution is weak.

**Oracle/upper-bound baselines.** If applicable, include an oracle baseline that establishes the performance ceiling. This contextualizes how much room for improvement remains. Example: for a retrieval task, an oracle retriever that always returns the ground-truth document.

**Ablation baselines.** These are not comparison baselines but method-internal baselines. They belong in the ablation experiment group, not the baseline group. Do not mix them.

### Step 3: Baseline Configuration

For each selected baseline, document the exact configuration. Incomplete configuration documentation makes experiments unreproducible and invites reviewer skepticism.

#### 3.1 Model Specification

Document:
- Architecture (e.g., "BERT-base, 12-layer Transformer, 768 hidden, 12 heads")
- Parameter count
- Pretrained weights (e.g., "bert-base-uncased from HuggingFace", or "trained from scratch")
- Tokenizer (e.g., "WordPiece, 30k vocab") and any special tokens
- Input format (e.g., "max sequence length 512, truncation from right")
- Any model modifications from the original (e.g., "added linear classification head with 256 hidden units")

#### 3.2 Training Configuration

Document:
- Optimizer (e.g., "AdamW, β1=0.9, β2=0.999, ε=1e-8")
- Learning rate and schedule (e.g., "peak LR 3e-5, linear warmup 10% of steps, linear decay")
- Batch size (per GPU and total effective batch size if using gradient accumulation)
- Number of epochs or training steps
- Early stopping criteria (e.g., "patience=5 on validation loss, restore best checkpoint")
- Weight decay and any other regularization
- Gradient clipping (max norm or value)
- Mixed precision (FP16/BF16) if used
- Random seed(s)

#### 3.3 Data Configuration

Document:
- Dataset name and version (e.g., "SQuAD v2.0")
- Train/validation/test split used
- Any preprocessing differences from your method
- Data augmentation applied (if any)
- If the baseline uses a different data split than your method, document and justify

#### 3.4 Compute Budget

Document the GPU hours allocated to each baseline. All baselines should receive comparable compute. Giving your method more tuning budget than baselines is unfair.

For each baseline, record:
- GPU type (e.g., "NVIDIA A100 80GB")
- Number of GPUs used
- Wall-clock training time
- Total GPU hours
- Hyperparameter tuning budget (separate from training budget)

If a baseline requires significantly more or less compute than others, document why. Example: "Baseline X uses 4× more GPU hours because it trains a larger model (1.5B vs 300M parameters). This reflects the method's design, not an unfair allocation."

#### 3.5 Hyperparameter Tuning

Document how hyperparameters were selected for each baseline:

**Option A: Default hyperparameters from the original paper.** Use when the original paper's hyperparameters are well-documented and applicable to your setting. Document: "Hyperparameters from [paper], Table 3. No additional tuning."

**Option B: Grid/random search.** Use when the original hyperparameters are not applicable (different dataset, different scale) or not documented. Document the search space, number of trials, and selection criterion (e.g., "best validation loss among 20 random trials").

**Option C: Bayesian optimization or other automated tuning.** Use when the search space is large. Document the method, number of trials, and selection criterion.

**Fairness rule:** Apply the same tuning methodology to all baselines and to your method. If you use 50 trials of Bayesian optimization for your method but only default hyperparameters for baselines, the comparison is unfair. If tuning budgets differ, document and justify.

#### 3.6 Evaluation Protocol

Document:
- Evaluation metrics (primary and secondary)
- Statistical significance testing methodology (e.g., "bootstrap resampling, 1000 iterations, p<0.05")
- Number of evaluation runs (e.g., "mean and std over 5 random seeds")
- Any post-processing of predictions before evaluation
- If using a different evaluation protocol than the original baseline paper, document and justify

### Step 4: Reproduction Validation

If reimplementing a baseline (no public code, or code that cannot be run directly), validate the reproduction before using it in comparisons.

#### 4.1 Implementation

Implement from the paper description. Prioritize fidelity to the described method over convenience. If the paper is ambiguous about a detail, make a reasonable choice and document it.

#### 4.2 Validation Protocol

1. Run the reimplementation on a small validation set that matches the original paper's setting as closely as possible.
2. Compare against the published numbers for the same setting.
3. If your reproduction differs from published results by more than a threshold, investigate before proceeding.

**Reproduction accuracy thresholds:**
- **Exact match expected** (deterministic metric, same data, same code): difference should be < 0.1%
- **Close match expected** (stochastic training, same data): difference should be within 1-2% relative
- **Approximate match acceptable** (different implementation, similar data): difference should be within 5% relative
- **Large discrepancy** (> 5% relative difference): investigate. Possible causes: implementation bug, different data preprocessing, different hyperparameters, or the original paper's results are not reproducible.

#### 4.3 Handling Reproduction Failure

If reproduction consistently underperforms published results:
1. Check for implementation bugs (incorrect loss function, wrong activation, missing normalization).
2. Check data preprocessing (tokenization, truncation, special tokens).
3. Check hyperparameters (learning rate, batch size, schedule).
4. Search for errata or author clarifications.
5. If the gap persists after exhausting these checks, document the discrepancy and use the best reproduction you can achieve. Note in the plan: "Our reproduction of [Method] achieves [X] vs published [Y]. We use our reproduction for fair comparison under identical conditions."

If reproduction consistently outperforms published results, your implementation may be incorrect in a way that benefits the baseline — this is also a problem. Investigate with the same rigor.

#### 4.4 Documentation

For every reimplemented baseline, document in the plan `.md`:

```
Reproduction validation:
- Published result: [metric] = [value] on [dataset/setting]
- Our reproduction: [metric] = [value] on [dataset/setting]
- Difference: [absolute and relative]
- Validation dataset: [description]
- Conclusion: [acceptable match / discrepancy noted — see investigation below]
```

### Step 5: Baseline Fairness Audit

Before finalizing the baseline set, conduct a systematic fairness audit. This is the last line of defense against unintentional bias.

#### 5.1 Audit Checklist

Verify each of the following. If any check fails, correct the issue or document a clear justification.

**Coverage:**
- [ ] Every major approach category from the landscape survey is represented by at least one baseline.
- [ ] Any missing categories are explicitly documented with justification.
- [ ] At least one simple/trivial baseline is included to calibrate task difficulty.

**Strength:**
- [ ] The strongest available configuration is used for each baseline.
- [ ] No baseline is intentionally weakened (e.g., using a smaller model variant when a larger one is standard, using fewer training steps than the original paper, using a weaker optimizer).
- [ ] If a weaker configuration is used, the reason is documented (e.g., "We use BERT-base rather than BERT-large because all methods in our comparison use base-scale models for fair comparison").

**Compute fairness:**
- [ ] All baselines receive comparable compute budgets for training.
- [ ] All baselines receive comparable hyperparameter tuning budgets.
- [ ] If compute budgets differ, the difference reflects the method's design, not an unfair allocation.

**Evaluation fairness:**
- [ ] All baselines are evaluated under the same protocol (same metrics, same statistical testing, same number of runs).
- [ ] If a baseline uses a different evaluation protocol, the difference is documented and justified.
- [ ] Results are not cherry-picked (e.g., reporting the best of 10 runs for your method but only 1 run for baselines).

**Data fairness:**
- [ ] All baselines use the same dataset splits as your method.
- [ ] If a baseline uses different data, the difference is documented and justified.
- [ ] No baseline has access to more training data than your method.

**Implementation fairness:**
- [ ] All reimplemented baselines have been validated against published results.
- [ ] Any reproduction discrepancies are documented.
- [ ] Third-party implementations have been vetted for correctness.

#### 5.2 Common Fairness Violations

These patterns appear frequently in submissions and are flagged by reviewers:

**Asymmetric tuning.** Your method gets 100 hyperparameter trials; baselines get default values. Fix: equalize tuning budgets or document the asymmetry.

**Asymmetric model scale.** Your method uses a 1B-parameter model; baselines use 100M-parameter models. Fix: either scale baselines up or scale your method down, or document why the scale difference is inherent to the methods.

**Asymmetric data.** Your method trains on additional data (e.g., synthetic data, external datasets) that baselines do not have access to. Fix: either give baselines the same data or report results both with and without the additional data.

**Asymmetric evaluation.** Your method is evaluated with a more favorable metric or protocol. Fix: use identical evaluation for all methods.

**Cherry-picked baseline results.** You report the best published number for your method but a weaker published number for a baseline, when the baseline paper also reports stronger results under different settings. Fix: use consistent selection criteria for all reported numbers.

**Strawman baselines.** You compare against a simplified or outdated version of a baseline when a stronger version exists. Fix: use the strongest available version.

#### 5.3 Documenting the Audit

Append the audit results to the plan `.md`:

```
## Baseline Fairness Audit

### Coverage
- Categories identified: [N]
- Categories represented: [N]
- Missing categories: [list with justification for each]

### Strength Verification
- [Baseline 1]: strongest config? [yes/no — if no, justification]
- [Baseline 2]: strongest config? [yes/no — if no, justification]
- ...

### Compute Budget Comparison
| Method | Training GPU-h | Tuning GPU-h | Total GPU-h |
|--------|---------------|--------------|-------------|
| Ours   | X             | Y            | Z           |
| ...

### Evaluation Protocol Consistency
- All methods evaluated with: [metrics, statistical tests, number of runs]
- Any deviations: [list with justification]

### Reproduction Validation Summary
- Reimplemented baselines: [N]
- Validated against published results: [N]
- Discrepancies: [list with resolution]
```

---

## Common Pitfalls

### Missing Entire Approach Categories

If your method is a new attention mechanism and you only compare against standard attention, you have not proven superiority over sparse or linear alternatives. The reviewer will ask: "How does this compare to Longformer? Performer? Mamba?" If you cannot answer, the empirical contribution is incomplete.

**Prevention:** The scholar dispatch in Step 1 must be thorough. If the scholar returns fewer than 4 categories for a mature field, the search was insufficient — re-dispatch with more specific prompts.

### Using Outdated Baselines

Comparing against methods from 2019 when 2024 methods exist in the same category. Reviewers will ask why. If the 2019 method is genuinely still the strongest in its category, document this. Otherwise, update.

**Prevention:** For each baseline, verify that no stronger method in the same category has been published since. The scholar dispatch should explicitly ask for the strongest method, not the most famous one.

### Unfair Compute Allocation

Giving your method 4× more GPU hours for hyperparameter tuning than baselines. This is one of the most common fairness violations and one of the easiest for reviewers to detect.

**Prevention:** Track tuning budgets separately from training budgets. Compare total compute per method. If your method requires more compute by design (e.g., it trains a larger model), document this — but do not give it more tuning budget.

### Cherry-Picked Baseline Results

Reporting the best published number for your method but a weaker number for baselines. This can happen unintentionally if you pull baseline numbers from different papers that use different evaluation protocols.

**Prevention:** Re-evaluate all baselines under your evaluation protocol whenever possible. If you must use published numbers, use a consistent selection rule (e.g., "the number reported in the original paper for the same dataset and metric").

### Weak Baseline Implementations

A buggy reimplementation that underperforms the published results. Your method looks strong by comparison, but the comparison is invalid.

**Prevention:** Always validate reproduction against published numbers (Step 4). If reproduction is significantly worse than published, fix the implementation or document the discrepancy.

### Ignoring Simple Baselines

Omitting simple baselines makes it impossible to assess whether the task is genuinely hard or whether all methods (including yours) are barely better than random.

**Prevention:** Always include at least one simple baseline. If your method does not substantially outperform it, the contribution may be weak — better to discover this during method-spec than during paper-audit.

### Overlooking Computational Cost

Comparing against baselines without accounting for inference cost, memory usage, or latency. A method that achieves +0.5 BLEU but requires 10× more inference time may not be a meaningful improvement.

**Prevention:** If computational efficiency is relevant to the contribution, include efficiency metrics (throughput, memory, latency) in the evaluation. If your method is more expensive than baselines, acknowledge this as a limitation.

### Baseline-Proxy Mismatch

Using a baseline designed for Task A as a proxy for Task B without verifying that the adaptation is reasonable. The baseline may underperform because it was not designed for the task, not because your method is superior.

**Prevention:** When adapting a baseline to a new task, invest reasonable effort in making the adaptation work well. Document the adaptation. If the baseline still underperforms, acknowledge that the comparison may not be fully fair.

---

## Baseline Documentation Template

For the plan `.md`, document each baseline using this template. Include all baselines in a dedicated "Baselines" section within the experiment matrix.

```
### Baseline: [Method Name] ([Year], [Venue])

- **Category:** [approach category]
- **Reference:** [full paper citation: authors, title, venue, year]
- **Code:** [repository URL] or "reimplemented" or "third-party: [URL]"
- **Selection rationale:** [why this method was chosen as the representative for this category]

**Model:**
- Architecture: [details]
- Parameters: [count]
- Pretrained weights: [source or "trained from scratch"]
- Tokenizer: [details]
- Input format: [max length, truncation strategy, special tokens]

**Training:**
- Optimizer: [name, hyperparameters]
- Learning rate: [peak LR, schedule, warmup]
- Batch size: [per GPU, total effective]
- Epochs/steps: [count]
- Early stopping: [criteria]
- Regularization: [weight decay, dropout, etc.]
- Mixed precision: [FP16/BF16/none]
- Random seeds: [list]

**Data:**
- Dataset: [name, version]
- Split: [train/val/test sizes]
- Preprocessing: [any differences from our method]

**Hyperparameter Tuning:**
- Method: [default from paper / grid search / random search / Bayesian]
- Search space: [ranges for each hyperparameter]
- Trials: [number]
- Selection criterion: [e.g., "best validation loss"]

**Compute Budget:**
- GPU type: [model]
- GPUs: [count]
- Training time: [wall-clock]
- Training GPU-h: [total]
- Tuning GPU-h: [total]
- Total GPU-h: [sum]

**Reproduction Validation:** (if reimplemented)
- Published result: [metric] = [value] on [setting]
- Our reproduction: [metric] = [value] on [setting]
- Difference: [absolute, relative]
- Conclusion: [acceptable / discrepancy noted]

**Expected Performance Range:** (optional, for sanity checking)
- Based on published results, we expect [metric] in range [low-high] on [dataset].
  If results fall outside this range, investigate before proceeding.
```

---

## Integration with Experiment Matrix

Baselines map to the experiment matrix as follows:

| Experiment Group | Contains | Tool Action |
|-----------------|----------|-------------|
| `sanity` | Simple/trivial baselines, reproduction validation runs | `research_experiment(action="register", group="sanity")` |
| `baselines` | All comparison baselines | `research_experiment(action="register", group="baselines")` |
| `main` | Your method (primary configuration) | `research_experiment(action="register", group="main")` |
| `ablations` | Your method variants (component removal) | `research_experiment(action="register", group="ablations")` |

Register baseline experiments with explicit references to the plan:

```
research_experiment(action="register",
  title="Baseline: [Method Name]",
  group="baselines",
  plan="plan_XXX",
  idea="idea_XXX",
  backend="inspire",
  content="## Setup\n\n[configuration details from baseline documentation template]")
```

---

## Baseline Lifecycle

Baselines are not static. They may need to be updated during the research project:

**During method-spec:** Baseline selection and configuration. This reference covers this phase.

**During experiment-cycle:** If a baseline underperforms expectations (sanity check failure), investigate before proceeding. The baseline may have a configuration error, or the published results may not be reproducible in your setting.

**During claim-build:** If new baselines are published after your experiments began, assess whether they must be included. A new SOTA method published during your project may need to be added as a baseline, especially if it appears in the same category as your method.

**During paper-audit:** The auditor verifies that baseline results are correctly reported and that no fairness violations exist.

**During venue-cycle (revision):** Reviewers may request additional baselines. Treat these requests as high-priority — a reviewer-requested baseline that outperforms your method is a serious issue that may require method revision.

---

## Quick Reference: Baseline Selection Decision Tree

```
For each approach category:
│
├── Strongest method has public code?
│   ├── YES → Use it. Document configuration.
│   └── NO → Can you reimplement?
│       ├── YES → Reimplement. Validate reproduction (Step 4).
│       └── NO → Third-party implementation available?
│           ├── YES → Use it. Validate reproduction.
│           └── NO → Next strongest method with code?
│               ├── YES → Use it. Document substitution.
│               └── NO → Document gap. Category not represented.
│
├── Method uses same datasets as your plan?
│   ├── YES → Use published numbers or re-evaluate (prefer re-evaluation).
│   └── NO → Must re-evaluate on your datasets. Factor into compute budget.
│
└── Method is from 2023-2026?
    ├── YES → Good.
    └── NO → Is it still the strongest in its category?
        ├── YES → Use it. Document recency justification.
        └── NO → Find a more recent method.
```
