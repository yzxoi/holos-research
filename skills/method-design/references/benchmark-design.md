# Benchmark Design


## Benchmark Selection Protocol

### Step 1: Survey Current Standards

Dispatch scholar subagents to survey the benchmark landscape. Run multiple scholars in parallel — one per sub-area or task variant. Each scholar returns structured findings; the main agent synthesizes. Use `mcp__scholight__search_papers` for discovery (replaces the legacy arXiv search): focused natural-language query per sub-area, `strength: "thorough"`, `limit: 10`, `date_from`/`date_to` for the 2024-2026 window. Fall back to websearch/webfetch on arxiv.org or the arXiv search tool only if scholight is unavailable.

```
task(subagent_type="scholar", background=true,
  "Survey current standard benchmarks for [task] in [subfield].
   Use mcp__scholight__search_papers (strength='thorough', limit=10, date_from/date_to
   for 2024-2026). For each benchmark found, report:
   - Name and year introduced
   - Task format and evaluation protocol
   - Current SOTA performance (cite specific papers with numbers)
   - Known limitations or criticisms
   - Community adoption level (widely used / niche / deprecated)
   Focus on benchmarks from 2024-2026. Flag any benchmark older than 2023 as potentially obsolete.
   For each benchmark, note whether it is:
   - A leaderboard benchmark (public test set, competitive)
   - A diagnostic benchmark (probes specific capability)
   - A stress benchmark (extreme conditions, failure boundaries)
   - A domain-specific benchmark (narrow field, specialized metrics)")
```

If the task domain is broad, split the survey:

```
# Parallel dispatch — all run simultaneously
task(subagent_type="scholar", background=true, "Survey benchmarks for [task] in [sub-area A]...")
task(subagent_type="scholar", background=true, "Survey benchmarks for [task] in [sub-area B]...")
task(subagent_type="scholar", background=true, "Survey benchmarks for [task] in [sub-area C]...")
```

After scholars return, ingest any newly discovered benchmark papers into the wiki:

```
research_wiki(action="ingest_paper", title="...", arxiv="...", ...)
```

### Step 2: Evaluate Each Candidate

For every benchmark identified, evaluate against these five criteria. Score each 1-5. A benchmark scoring below 3 on any criterion is a weak candidate.

#### Relevance

Does the benchmark directly measure the claimed contribution? A benchmark that measures a different capability is noise, not evidence.

- Score 5: The benchmark's primary metric is the exact quantity the claim asserts improvement on
- Score 3: The benchmark measures a related but distinct capability; the connection requires explanation
- Score 1: The benchmark measures something tangential; including it would weaken the evidence chain

If the connection between benchmark and claim requires more than one sentence to explain, the benchmark is probably not relevant.

#### Currency

Is the benchmark a current community standard? Benchmarks older than 2-3 years may be saturated, have known exploits, or be considered obsolete by reviewers.

- Score 5: Introduced 2024-2026, actively used in recent top-venue papers
- Score 3: Introduced 2022-2023, still cited but showing signs of saturation
- Score 1: Introduced before 2022, or known to be deprecated/saturated

Using an obsolete benchmark undermines credibility even with strong results. Reviewers will ask: "Why didn't you evaluate on [current standard]?"

#### Difficulty

Is there meaningful headroom between current SOTA and the theoretical ceiling? If SOTA is already at 98% accuracy, a 0.5% improvement is uninformative regardless of statistical significance.

- Score 5: SOTA is well below ceiling (e.g., 65% accuracy on a task where 100% is achievable); clear room for meaningful improvement
- Score 3: SOTA is approaching ceiling (e.g., 88%); improvements will be incremental
- Score 1: SOTA is at or near ceiling (e.g., 97%+); benchmark is effectively solved

For benchmarks with no clear ceiling (e.g., generation quality), assess whether the metric has sufficient dynamic range to discriminate between methods. If all top methods cluster within 0.5 points, the benchmark has low discriminative power.

#### Diversity

Do the selected benchmarks collectively cover the dimensions the claim requires? Different domains, languages, difficulty levels, input lengths, or task variants.

Evaluate diversity across the full candidate set, not per-benchmark. A set of three benchmarks that all test the same thing in the same way is not diverse.

Dimensions to consider:
- Domain (news, scientific, medical, code, dialogue, etc.)
- Language (English-only vs multilingual)
- Scale (small diagnostic vs large-scale)
- Difficulty (easy vs hard subsets)
- Input modality (text, code, structured data, multimodal)
- Evaluation protocol (automatic metrics, human evaluation, LLM-as-judge)

A single benchmark is rarely sufficient for a top-venue paper. Aim for 3-5 benchmarks spanning at least two distinct dimensions.

#### Reproducibility

Is the evaluation protocol well-documented and executable? Can you reproduce the exact evaluation pipeline?

- Score 5: Official evaluation script available, deterministic, well-documented; results are reproducible bit-for-bit
- Score 3: Protocol is documented but requires interpretation; minor ambiguities in metric computation
- Score 1: Protocol is vague, metric computation is ambiguous, or the benchmark requires a submission platform with opaque evaluation

Check for:
- Known issues with metric computation (e.g., tokenization mismatches in BLEU, normalization differences in accuracy)
- Data preprocessing ambiguities (train/test split construction, filtering criteria)
- Platform-specific constraints (submission limits, evaluation queues, private test sets)

### Step 3: Document Each Selected Benchmark

For every benchmark committed to the plan, produce a complete documentation block. This is not optional — undocumented benchmarks create ambiguity during the experiment and claim phases.

#### Benchmark Identity

Full name, paper citation, year introduced, URL to official repository or dataset. If the benchmark has multiple versions, specify which version.

```
GLUE (Wang et al., 2018) — using the SuperGLUE subset (Wang et al., 2019)
Repository: https://github.com/...
```

#### Claim Mapping

One sentence mapping the benchmark to a specific claim. If a benchmark maps to multiple claims, list each mapping separately. If a benchmark maps to no claim, remove it.

```
Tests claim: "Our factorized decoding reduces sequence-level error by decoupling content planning from surface realization."
```

#### Current SOTA

The strongest published number on this benchmark, with citation. If multiple numbers exist under different settings (e.g., with/without external data, different model scales), note which setting you are comparing against.

```
Current SOTA: 89.3 BLEU (Smith et al., 2025, EMNLP) — base model, no external data
Also reported: 91.1 BLEU (Chen et al., 2025, ACL) — with back-translation augmentation
Our comparison target: 89.3 (same setting as our method)
```

If SOTA numbers are inconsistent across papers (different metric implementations, different test set versions), flag this as a reproducibility risk.

#### Target Threshold

The quantitative improvement that would constitute meaningful evidence. Not "better than baseline" — a specific number or range. Define both:

- **Minimum meaningful**: The smallest improvement that would be scientifically interesting (not just statistically significant). Below this, the result is technically positive but practically uninformative.
- **Convincing**: The improvement that would make a reviewer nod. At or above this, the evidence is strong.

```
Target threshold:
- Minimum meaningful: +1.5 BLEU (exceeds typical inter-seed variance of ±0.8)
- Convincing: +3.0 BLEU (would place method clearly above all published baselines)
```

If you cannot define these thresholds, the benchmark may not provide discriminative evidence.

#### Known Caveats

Any limitations, criticisms, or failure modes of this benchmark that reviewers might raise. Address them proactively — acknowledging a caveat in the plan is stronger than being surprised by it during review.

```
Known caveats:
- BLEU correlates weakly with human judgment for this task (Novikova et al., 2017)
- Test set is English-only; cross-lingual generalization is untested
- Dataset construction used automatic filtering that may introduce selection bias
- Metric variance across seeds is high (±1.2 BLEU); single-seed results are unreliable
```

### Step 4: Benchmark Selection Gate

Before finalizing benchmark choices, verify all of the following. If any check fails, return to Step 2 and adjust the selection.

#### Claim Coverage

Every core claim has at least one benchmark that directly tests it. Map claims to benchmarks explicitly:

```
Claim 1 (factorized decoding reduces error) → WMT22 En-De, WMT23 En-Fr
Claim 2 (factorization adds minimal overhead) → latency benchmark on WMT22 En-De
```

If a claim has no benchmark, either add a benchmark or remove the claim.

#### No Convenience Benchmarks

No benchmark is included solely because it is easy to run, has existing infrastructure, or produced good preliminary results. Every benchmark must trace to a claim.

Remove any benchmark where the justification is "we already have the data" or "it's easy to evaluate."

#### Defensibility

The benchmark set is defensible to a skeptical reviewer. Ask: if a reviewer challenges each benchmark choice, can you give a one-sentence justification that references community standards?

If a standard benchmark exists in the field but is not in the set, document the reason:

```
Excluded: SQuAD v2.0 — our method targets generation tasks; SQuAD is extractive QA and does not test the claimed mechanism.
```

#### Minimum Viable Set

Identify the smallest subset of benchmarks that would still constitute a valid paper. This is the fallback if compute budget is constrained. The full set is aspirational; the minimum viable set is non-negotiable.

```
Minimum viable set: WMT22 En-De (main result) + WMT23 En-Fr (cross-language) + latency benchmark (efficiency claim)
Full set: above + WMT23 En-Zh + COMET human correlation study + domain shift robustness
```

---

## Common Pitfalls

### Benchmarks That Are Too Easy

If the method achieves near-perfect scores on a benchmark, the benchmark provides no discriminative information. The result is not evidence — it is noise.

Detection: during pilot experiments, if baseline and method both score >95%, the benchmark is too easy.

Remediation:
- Switch to a harder benchmark in the same domain
- Use a more challenging subset or setting (e.g., zero-shot instead of fine-tuned, longer inputs, adversarial examples)
- If no harder variant exists, drop the benchmark — a ceiling effect result is worse than no result

### Benchmarks That Are Obsolete

Benchmarks from 2018-2020 may have known exploits, saturated performance, or deprecated evaluation protocols. Reviewers will question why current standards were not used.

Detection: benchmark is >3 years old AND a newer benchmark exists for the same task.

Remediation:
- Replace with the current standard
- If the old benchmark is still the standard (rare but possible), document why and note that no newer alternative exists
- If using both old and new, frame the old benchmark as "for historical comparison only"

### Benchmarks That Do Not Test the Claim

A benchmark that measures accuracy when the claim is about efficiency is misaligned evidence. Each benchmark must map to a specific claim.

Detection: you cannot write a one-sentence mapping from benchmark to claim without using the word "related" or "tangential."

Remediation:
- Remove the benchmark
- If the benchmark is genuinely important for context (e.g., showing the method does not regress on standard metrics), label it explicitly as a "sanity check" rather than a claim benchmark

### Single-Benchmark Evidence

A single benchmark rarely provides sufficient evidence for a top-venue paper. Multiple benchmarks across different dimensions strengthen the evidence chain.

Detection: the benchmark set has size 1.

Remediation:
- Add benchmarks that test different dimensions (different domains, languages, scales, task variants)
- If the field genuinely has only one standard benchmark, add diagnostic experiments (ablations, stress tests, qualitative analysis) to supplement
- If no additional benchmarks exist, document this as a limitation and consider creating a benchmark (see "When No Suitable Benchmark Exists")

### Ignoring Benchmark-Specific Evaluation Protocols

Some benchmarks have strict evaluation requirements: specific train/test splits, metric computation scripts, submission platforms. Violating these protocols invalidates results.

Detection: you have not read the benchmark's official evaluation documentation.

Remediation:
- Locate and read the official evaluation script or documentation
- Replicate the exact metric computation pipeline — do not reimplement metrics from memory
- If the benchmark uses a submission platform (e.g., Kaggle, CodaLab, EvalAI), verify access and submission limits before committing to the benchmark
- For benchmarks with private test sets, verify that the test set is still available and that submission is possible

### Metric Mismatch Across Benchmarks

Different benchmarks may use different implementations of the "same" metric, producing incomparable numbers. BLEU computed with different tokenizers can differ by 1-2 points.

Detection: you are comparing numbers across benchmarks without verifying metric computation.

Remediation:
- Use the official metric implementation for each benchmark
- Report which metric implementation was used (version, tokenizer, parameters)
- Do not compare numbers across benchmarks unless metric computation is identical

### Test Set Contamination

If the method or its underlying model may have been trained on benchmark data, results are invalid. This is especially relevant when using pre-trained models (LLMs, foundation models).

Detection: the benchmark's training data may overlap with the pre-training corpus of the model being used.

Remediation:
- Check whether the benchmark was released after the model's knowledge cutoff
- Use decontamination tools if available
- For LLM-based methods, prefer benchmarks with verified non-overlap or use post-cutoff benchmarks
- Document any contamination risk in the caveats

---

## When No Suitable Benchmark Exists

If the survey reveals no adequate benchmark for a claim, this is a finding — not a failure. The absence of a benchmark may itself indicate a research gap worth documenting.

### Document the Gap

Record the finding in the plan:

```
Benchmark gap: No existing benchmark tests [specific capability].
Current benchmarks measure [related capability A] and [related capability B],
but neither captures [the specific dimension our claim requires].
```

This documentation serves two purposes: it justifies any benchmark creation effort, and it preempts reviewer questions about why standard benchmarks were not used.

### Option A: Create a Benchmark

If the claim is central and no benchmark exists, create one. This is significant additional work — factor it into the timeline explicitly.

Benchmark creation requires:
1. **Task definition**: precise input/output specification, clear success criteria
2. **Data collection or generation**: human annotation, synthetic generation, or curation from existing sources
3. **Quality control**: inter-annotator agreement, data validation, bias assessment
4. **Evaluation protocol**: metric definition, baseline implementation, scoring script
5. **Baseline results**: run existing methods on the new benchmark to establish reference points
6. **Documentation**: dataset card, license, intended use, limitations

Estimate: benchmark creation typically adds 2-4 weeks to the timeline. Do not underestimate this.

If the benchmark is synthetic or LLM-generated, document the generation procedure and any validity concerns. Reviewer skepticism toward synthetic benchmarks is high — plan for human validation.

### Option B: Reframe the Claim

If creating a benchmark is infeasible, narrow or reformulate the claim to align with existing benchmarks.

```
Original claim: "Our method improves factual consistency in long-form generation."
Problem: No standard benchmark for factual consistency in long-form generation.
Reformulated claim: "Our method reduces hallucination rate on XSum (factual consistency subset)."
```

The reformulated claim is narrower but testable. A narrow, testable claim is stronger than a broad, untestable one.

### Option C: Use Proxy Evidence

If neither creation nor reframing is viable, use proxy evidence with explicit caveats:

```
Proxy evidence: We evaluate on [benchmark X] which measures [related capability].
This is an imperfect proxy for [claimed capability] because [specific gap].
Results should be interpreted as suggestive, not conclusive.
```

Proxy evidence is weak evidence. It should supplement, not replace, direct evidence. If all evidence for a claim is proxy evidence, the claim is not adequately supported.

---

## Benchmark Documentation Template

For the plan `.md`, document each benchmark using this exact format. Consistency across benchmarks makes the plan auditable and the experiment phase unambiguous.

```
### Benchmark: [Full Name] ([Year])
- **Tests claim**: [which specific claim, by ID or one-line description]
- **Paper**: [full citation: authors, title, venue, year]
- **Repository**: [URL to official code/data]
- **Task format**: [input type → output type, one sentence]
- **Dataset size**: [train/dev/test sizes, if applicable]
- **Primary metric**: [exact metric name and implementation]
- **Current SOTA**: [number] ([citation], [venue year]) — [setting notes]
- **Target threshold**: minimum meaningful [X], convincing [Y]
- **Evaluation protocol**: [how metrics are computed, which script/package, any special requirements]
- **Known caveats**: [limitations, criticisms, metric issues, contamination risks]
- **Fallback if unavailable**: [alternative benchmark or plan if this benchmark becomes inaccessible]
```

### Example

```
### Benchmark: WMT22 English-German (2022)
- **Tests claim**: Claim 1 — factorized decoding reduces sequence-level translation error
- **Paper**: Kocmi et al., "Findings of the 2022 Conference on Machine Translation (WMT22)", WMT, 2022
- **Repository**: https://github.com/wmt-conference/wmt22-news-systems
- **Task format**: English source sentence → German translation
- **Dataset size**: train: 4.5M pairs, dev: newstest2021 (2,002), test: newstest2022 (2,037)
- **Primary metric**: SacreBLEU (v2.3.1, `--tokenize 13a --force`)
- **Current SOTA**: 32.8 SacreBLEU (Johnson et al., 2025, ACL) — Transformer-Big, no back-translation
- **Target threshold**: minimum meaningful +0.8, convincing +1.5
- **Evaluation protocol**: SacreBLEU via official script; beam size 5; single-seed results averaged over 3 runs
- **Known caveats**: BLEU is a surface-level metric; supplement with COMET-22 for semantic quality. Test set is news domain only — domain generalization is untested.
- **Fallback if unavailable**: WMT21 En-De (same task, slightly older, SOTA 31.5)
```

---

## Integration with the Experiment Phase

Benchmark documentation in the plan directly feeds the experiment phase. The experiment agent reads the plan's benchmark blocks and uses them to:

1. **Set up evaluation**: locate the official evaluation script, install dependencies, verify metric computation
2. **Establish baselines**: reproduce or cite the SOTA numbers listed
3. **Judge results**: compare experiment outputs against the target thresholds
4. **Detect issues**: flag results that hit known caveats (e.g., metric instability, ceiling effects)

Incomplete benchmark documentation in the plan causes delays in the experiment phase. Every field in the template exists because the experiment agent needs it.

---

## Special Cases

### Leaderboard Benchmarks

Benchmarks with public leaderboards (e.g., GLUE, SuperGLUE, Open LLM Leaderboard) have additional considerations:

- **Submission limits**: many leaderboards limit submission frequency. Verify limits before committing.
- **Test set access**: some leaderboards keep test sets private. You cannot run local evaluation — you must submit.
- **Leaderboard dynamics**: SOTA on leaderboards changes rapidly. The number documented in the plan may be stale by experiment time. Re-check SOTA before running experiments.
- **Overfitting risk**: if the test set is public and old, methods may have overfit through repeated submission. Prefer benchmarks with private or recently released test sets.

### Human Evaluation Benchmarks

Benchmarks requiring human evaluation (e.g., summarization quality, dialogue coherence) have additional considerations:

- **Cost**: human evaluation is expensive and slow. Budget at least $500-2000 and 2-4 weeks.
- **Protocol**: define the exact evaluation protocol before experiments begin — number of annotators, rating scale, inter-annotator agreement threshold, qualification criteria
- **IRB**: verify whether IRB approval is needed. If uncertain, assume it is.
- **Alternatives**: consider LLM-as-judge as a cheaper but weaker alternative. If using LLM-as-judge, validate against human judgments on a subset.

### Multilingual Benchmarks

Benchmarks spanning multiple languages require explicit decisions about which languages to evaluate:

- **Language selection**: justify which languages are included. "All available languages" is acceptable only if compute budget allows.
- **Script differences**: languages with different scripts may require different tokenization or preprocessing. Document these.
- **Metric comparability**: metrics may not be comparable across languages (e.g., BLEU is sensitive to morphological complexity). Do not average across languages without justification.

### Security and Safety Benchmarks

Benchmarks involving adversarial attacks, jailbreaking, or security evaluation have additional constraints:

- **Responsible disclosure**: if the method finds vulnerabilities, follow responsible disclosure practices
- **Legal risk**: some benchmarks involve generating or evaluating harmful content. Verify that using the benchmark does not violate platform terms of service or local regulations.
- **Dual-use concerns**: document whether the method could be used for harmful purposes and what mitigations exist.

---

## Quick Reference: Benchmark Selection Checklist

Before leaving the spec phase, verify:

- [ ] Scholar survey completed for all relevant sub-areas
- [ ] Each candidate benchmark scored on all 5 criteria (Relevance, Currency, Difficulty, Diversity, Reproducibility)
- [ ] Every core claim has at least one benchmark mapped to it
- [ ] No convenience benchmarks in the set
- [ ] Each selected benchmark fully documented using the template
- [ ] SOTA numbers are current (verified within the last month)
- [ ] Target thresholds are specific and quantitative
- [ ] Known caveats are documented for every benchmark
- [ ] Minimum viable set identified
- [ ] Excluded standard benchmarks have documented reasons
- [ ] Evaluation protocols verified (scripts located, access confirmed)
- [ ] Compute budget accounts for all benchmarks in the full set
- [ ] Contamination risks assessed for all benchmarks
- [ ] Special cases handled (leaderboards, human eval, multilingual, security)
