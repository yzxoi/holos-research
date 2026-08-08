# Dataset Design


## Dataset Planning Protocol

### Step 1: Determine Data Requirements

Derive concrete data requirements from the method design. Do not proceed with vague estimates — every decision below constrains what the experiment phase can and cannot do.

#### Task Type

Identify the task type. The task type determines data format, annotation needs, and evaluation protocol.

| Task Type | Data Format | Annotation Needs | Example |
|-----------|------------|------------------|---------|
| Classification | (input, label) pairs | Class labels | Sentiment analysis, image classification |
| Generation | (input, target_text) pairs | Reference outputs | Summarization, translation, code generation |
| Retrieval | (query, relevant_docs, irrelevant_docs) | Relevance judgments | Document retrieval, passage ranking |
| Ranking | (query, ordered_document_list) | Ordinal relevance scores | Learning-to-rank, recommendation |
| Structured prediction | (input, structured_output) | Structured annotations | NER, parsing, relation extraction |
| Multiple choice | (context, question, choices, answer_index) | Correct answer index | MMLU-style benchmarks |
| Reinforcement learning | (state, action, reward, next_state) trajectories | Reward signal or environment | RLHF, decision-making |
| Multimodal | (modality_A, modality_B, label/output) | Cross-modal alignment | Image captioning, VQA, video understanding |

#### Input Modality

Each modality has distinct collection, storage, and preprocessing requirements.

| Modality | Storage Format | Typical Size per Example | Key Concerns |
|----------|---------------|-------------------------|--------------|
| Text | JSONL, Parquet, JSON | 100B–100KB | Encoding, tokenization, language coverage |
| Image | PNG/JPEG files + metadata JSON | 10KB–10MB | Resolution, format consistency, EXIF stripping |
| Audio | WAV/MP3 files + metadata JSON | 100KB–100MB | Sample rate, channel count, duration variance |
| Video | MP4 files + metadata JSON | 1MB–1GB | Frame rate, resolution, compression artifacts |
| Tabular | CSV, Parquet | 100B–10KB | Missing values, categorical encoding, normalization |
| Multimodal | Mixed (file references in JSONL) | Varies | Cross-modal alignment, missing modalities |

#### Scale Estimate

Estimate the minimum viable dataset size. Use these heuristics as starting points, then calibrate against published work in the same domain.

- **Model size scaling**: Larger models need more data. A 7B-parameter model fine-tuned on fewer than 5,000 examples will likely overfit. A 100M-parameter model may work with 1,000–5,000 examples. Check what similar published work used.
- **Task complexity**: Simple classification may need 100–1,000 examples per class. Complex generation tasks may need 10,000–100,000+ examples. Structured prediction often needs more data than flat classification.
- **Baseline performance**: If a strong baseline already exists, estimate the delta you need to detect. Small deltas require larger test sets for statistical significance.
- **Domain specificity**: Specialized domains (medical, legal, scientific) may need fewer examples if the signal is strong, but each example is more expensive to obtain.

Document your scale estimate with justification:

```
Scale estimate: 10,000 training examples, 1,000 validation, 1,000 test
Justification: Similar work (Smith et al., 2024) used 8,000 examples for a 3B model.
               Our task is slightly more complex (multi-label vs binary), so we add 25%.
Risk: If collection yields fewer than 5,000 examples, switch to a smaller model backbone.
```

#### Quality Requirements

Define what constitutes a valid example and what noise level is acceptable.

- **Validity criteria**: Minimum input length, maximum output length, required fields present, format compliance. Examples that fail validity checks are discarded, not fixed.
- **Noise tolerance**: What percentage of mislabeled examples is acceptable? For classification, >5% label noise can significantly degrade performance. For generation, noisy references may be tolerable if the model learns from patterns rather than memorizing.
- **Edge case coverage**: List the edge cases the dataset must include. If the method claims robustness to a specific condition, the dataset must contain examples of that condition.
- **Quality floor**: Define the minimum quality threshold. If human annotation is involved, specify minimum inter-annotator agreement (e.g., Cohen's κ > 0.6, Krippendorff's α > 0.7).

#### Domain Specificity

- **General domain** (web text, common images, everyday speech): Data is abundant but noisy. Focus on filtering and deduplication.
- **Specialized domain** (medical, legal, scientific, financial): Data is scarce and requires domain expertise. Budget for expert annotation or careful synthetic generation. Verify that the model backbone has adequate pre-training coverage of the domain — a general-domain backbone fine-tuned on 500 medical examples may fail if it has never seen medical terminology.

---

### Step 2: Source Identification

Identify where the data will come from. For each source, document: access method, license, known quality issues, and fallback if the source becomes unavailable.

#### Existing Public Datasets

Search for datasets that match your requirements before building from scratch. Building a dataset is expensive; reusing an existing one is almost always faster and more defensible. Use `mcp__scholight__search_papers` for discovery (replaces the legacy arXiv search): focused natural-language query for dataset papers, `strength: "standard"`, `limit: 10`. Fall back to websearch/webfetch on arxiv.org or the arXiv search tool only if scholight is unavailable.

```
task(subagent_type="scholar", background=true,
  "Survey publicly available datasets for [task] in [domain].
   Use mcp__scholight__search_papers (strength='standard', limit=10) to find
   dataset papers and HuggingFace datasets.
   For each dataset, report:
   - Name, URL, and citation
   - Size (train/val/test counts)
   - Format and schema
   - License type (CC-BY, CC-BY-SA, CC0, Apache 2.0, custom, unknown)
   - Known quality issues (label noise, duplicates, biases, annotation artifacts)
   - Whether it has been used in published research at top venues
   - Access restrictions (login required, API key, request-only)
   - Last updated date
   - Language coverage (for text datasets)
   Return results as a structured table.")
```

If multiple datasets exist, evaluate them against your requirements:

| Criterion | Weight | How to Evaluate |
|-----------|--------|----------------|
| Task alignment | Critical | Does the dataset exactly match your task definition? |
| Size adequacy | Critical | Is it large enough for your model scale? |
| Quality | High | What is the known label noise rate? |
| License | High | Can you use it for research publication? |
| Community adoption | Medium | Is it a standard benchmark? Using standard benchmarks strengthens comparisons. |
| Freshness | Medium | Is it recent enough to reflect current data distributions? |

If no suitable dataset exists, proceed to building a new one.

#### Web Scraping and API Collection

When building a dataset from web sources:

- **Collection methodology**: Document the exact scraping or API query process. Include: seed URLs or queries, crawl depth, rate limits, user-agent strings, and any filters applied during collection.
- **Rate limits and politeness**: Respect `robots.txt`. Add delays between requests (≥1 second for academic scraping). For APIs, stay within the free tier unless you have explicit permission.
- **Legal compliance**: Check the terms of service for each source. Some sites prohibit scraping even for research. When in doubt, consult the user.
- **Deduplication**: Apply exact-match deduplication and near-duplicate detection (e.g., MinHash with threshold 0.8) during collection, not after. Deduplication after collection wastes storage and compute.
- **PII scrubbing**: Scan collected text for emails, phone numbers, IP addresses, and other personally identifiable information. Redact or remove. For images, strip EXIF metadata.
- **Fallback**: If a source blocks your scraper or changes its API, have a documented alternative source.

#### Synthetic Generation

When using LLMs or other models to generate training data:

- **Generation prompt**: Document the exact prompt template used. Include system prompts, few-shot examples, and output format instructions. The prompt is part of the dataset provenance.
- **Model selection**: Document which model generated the data (name, version, provider). Different models produce different data distributions — switching models mid-project changes the dataset.
- **Quality validation**: Define a validation procedure for synthetic data. Options: manual spot-checking (review N random examples), automated consistency checks (output format compliance, factual accuracy against a knowledge base), or comparison against a small human-annotated gold set.
- **Known failure modes**: Every synthetic data pipeline has failure modes. Document them: hallucination, repetition, format drift, bias amplification, mode collapse. Design the validation procedure to catch these.
- **Contamination risk**: If using a model that may have been trained on your evaluation data, synthetic generation can leak test-set information into training. Verify that the generator model's training cutoff predates your test data, or use a model with a known training corpus.

#### Human Annotation

When requiring human labels:

- **Annotation guidelines**: Write explicit, example-driven guidelines. Include: task definition, edge case handling, examples of correct and incorrect annotations, and a decision tree for ambiguous cases. Guidelines must be detailed enough that a new annotator can start without verbal instruction.
- **Annotator qualification**: Define minimum qualifications (domain expertise, language proficiency, task-specific training). Document how annotators were recruited and compensated.
- **Inter-annotator agreement**: Measure and report agreement metrics. For classification: Cohen's κ or Fleiss' κ. For span annotation: F1 overlap. For continuous scores: Pearson correlation or ICC. Set a minimum agreement threshold before accepting annotations.
- **Quality control**: Include gold-standard examples with known labels to detect annotator drift. If an annotator's accuracy on gold examples drops below threshold, retrain or replace them.
- **Adjudication**: Define how disagreements are resolved. Options: majority vote (for ≥3 annotators), expert adjudication (a senior annotator decides), or discard (remove examples where agreement is below threshold).
- **Budget**: Estimate cost. Professional annotation services charge $0.05–$1.00 per example depending on complexity. Crowdsourcing is cheaper but requires more quality control.

---

### Step 3: Preprocessing Design

Define the full preprocessing pipeline. Every step must be documented with thresholds and rationale. The pipeline must be deterministic — given the same raw data, it must produce identical output.

#### Cleaning

Apply cleaning steps in this order. Document the threshold for each filter and the number of examples removed.

1. **Exact deduplication**: Remove examples with identical input-output pairs. Use hashing (MD5 or SHA256 of the canonical representation) for efficiency.
2. **Validity filtering**: Remove examples that fail validity criteria (missing required fields, wrong format, out-of-range values).
3. **Quality filtering**: Remove low-quality examples. For text: minimum/maximum length, language detection (remove non-target languages), perplexity filtering (remove examples with anomalously high perplexity under a reference model). For images: minimum resolution, blur detection, NSFW filtering.
4. **Near-duplicate detection**: Apply MinHash or SimHash to remove near-duplicates. Set the similarity threshold based on task sensitivity — lower thresholds (0.5–0.7) for tasks where diversity matters, higher thresholds (0.8–0.95) for tasks where near-duplicates are acceptable.
5. **Normalization**: Normalize formats. For text: Unicode normalization (NFC or NFKC), whitespace normalization, case folding (if appropriate for the task). For images: resize to consistent dimensions, convert to RGB. For audio: resample to consistent sample rate, convert to mono if stereo is unnecessary.
6. **Missing value handling**: For tabular data, decide per column: drop rows with missing values, impute (mean/median/mode/constant), or use a special missing token. Document the decision per column.

Record the filtering log:

```
Cleaning log:
- Raw examples: 150,000
- After exact dedup: 142,000 (removed 8,000)
- After validity filter: 138,000 (removed 4,000 — missing labels)
- After quality filter: 125,000 (removed 13,000 — length < 10 chars or > 2048 chars)
- After near-dedup: 118,000 (removed 7,000 — MinHash similarity > 0.85)
- After normalization: 118,000 (no examples removed)
Final: 118,000 examples
```

#### Tokenization

Tokenization choices must match the model backbone exactly.

- **Tokenizer selection**: Use the tokenizer that corresponds to the model backbone. If using `meta-llama/Llama-3-8B`, use its tokenizer. If using a custom tokenizer, document why and how it was trained.
- **Max sequence length**: Set based on task requirements and GPU memory constraints. Analyze the length distribution of your data — set the max length to cover ≥95% of examples. Truncate longer examples; do not discard them unless truncation would remove critical information.
- **Truncation strategy**: For text generation, truncate from the left (keep the end) if the task is completion, truncate from the right (keep the beginning) if the task is prefix-based. For classification, truncate from the right. Document the strategy.
- **Padding strategy**: Pad to max length in the batch (dynamic padding) for training efficiency. Use the tokenizer's pad token. If the tokenizer has no pad token, set `pad_token = eos_token` and document this.
- **Special tokens**: Verify that special tokens (BOS, EOS, SEP, CLS, MASK) are correctly set. Mismatched special tokens cause silent failures — the model trains but produces garbage.
- **Attention mask**: Always generate and use attention masks. Do not rely on the model to infer them.

#### Format Conversion

Transform raw data into the format expected by the training pipeline.

- **Schema definition**: Define the exact schema. For JSONL: one JSON object per line, with named fields. For Parquet: named columns with types. Document the schema in the plan `.md`.
- **Field mapping**: Map raw data fields to schema fields. If the raw data uses different field names, document the mapping.
- **Type enforcement**: Enforce types. Strings must be strings, integers must be integers. Type errors during training are hard to debug.
- **Serialization**: Choose a serialization format. JSONL is human-readable and line-addressable (good for debugging). Parquet is columnar and compressed (good for large datasets). Arrow is in-memory columnar (good for streaming).

Example schema documentation:

```
Schema (JSONL):
{
  "id": string,           // unique identifier, e.g., "example_000001"
  "input": string,        // raw input text
  "target": string,       // target output text
  "input_tokens": [int],  // tokenized input (added during preprocessing)
  "target_tokens": [int], // tokenized target (added during preprocessing)
  "metadata": {
    "source": string,     // data source identifier
    "length": int,        // character length of input
    "language": string    // detected language code
  }
}
```

#### Augmentation

If using data augmentation, document each technique.

- **Technique**: Name and describe each augmentation method (e.g., back-translation, synonym replacement, random cropping, SpecAugment).
- **Parameters**: Document all parameters (e.g., replacement probability, crop size range, mask size).
- **Application**: Specify when augmentation is applied — during preprocessing (static augmentation, produces a larger dataset) or during training (online augmentation, applied per batch).
- **Expected effect**: State what robustness property each augmentation is expected to improve.
- **Validation**: Verify that augmented examples remain valid. A back-translated sentence that loses the label-relevant content is harmful, not helpful.

---

### Step 4: Split Design

Define train, validation, and test splits. The split design is a scientific decision, not an implementation detail — it determines whether your evaluation is valid.

#### Split Ratios

| Dataset Size | Train | Validation | Test | Notes |
|-------------|-------|------------|------|-------|
| < 1,000 | 80% | 10% | 10% | Validation set may be too small for reliable early stopping. Consider cross-validation. |
| 1,000–10,000 | 80% | 10% | 10% | Standard split. Ensure ≥100 examples in validation and test. |
| 10,000–100,000 | 80% | 10% | 10% | Standard split. |
| 100,000–1,000,000 | 90% | 5% | 5% | Large validation/test sets are unnecessary; more training data helps more. |
| > 1,000,000 | 98% | 1% | 1% | Even 1% is a large absolute number. |

Adjust ratios if the task has high variance — larger test sets reduce confidence intervals.

#### Split Methodology

Choose the split methodology based on data characteristics:

- **Random split**: Default for IID data. Shuffle with a fixed random seed (record the seed). Use the same seed for all experiments.
- **Stratified split**: Preserve class distributions across splits. Required when classes are imbalanced or when class balance affects metric interpretation. Stratify by the label, not by input features.
- **Temporal split**: For time-series data, train on earlier time periods, validate on intermediate, test on the most recent. Never shuffle temporal data — it creates look-ahead bias.
- **Group-based split**: Prevent leakage by keeping all examples from the same group (user, document, patient, conversation) in the same split. Required when examples within a group are not independent. Use `GroupShuffleSplit` or `GroupKFold` from scikit-learn.
- **Cross-validation**: For very small datasets (< 1,000 examples), use k-fold cross-validation instead of a single train/val/test split. Report mean and standard deviation across folds. Use stratified k-fold if classes are imbalanced.

#### Split Documentation

Record the exact split in a version-controlled file. The split must be identical for all compared methods — if two methods use different splits, their results are not comparable.

```
data/splits/
├── train_ids.txt      # One example ID per line
├── val_ids.txt
├── test_ids.txt
└── split_config.json  # Seed, methodology, ratios, timestamp
```

Commit these files to git. They are small and essential for reproducibility.

#### Leakage Prevention

Verify that no information leaks from test/validation into training. Leakage is the most common and most damaging data mistake in ML research.

- **Example-level leakage**: Verify no example appears in multiple splits. Check by exact ID matching.
- **Group-level leakage**: If using group-based splits, verify no group appears in multiple splits.
- **Feature-level leakage**: Verify that normalization statistics (mean, variance) are computed from training data only and applied to validation/test. Verify that tokenizer vocabulary was not built from test data.
- **Hyperparameter leakage**: Using test set performance for hyperparameter selection, early stopping, or model selection invalidates the test set. The validation set is for model selection; the test set is touched exactly once, at the very end.
- **Temporal leakage**: For temporal splits, verify that all training timestamps precede all validation timestamps, which precede all test timestamps.
- **Contamination from pre-training**: If using a pre-trained model, verify that the test set was not included in the model's pre-training data. This is hard to verify definitively, but check: was the test set publicly available before the model's training cutoff? If yes, flag the risk.

---

### Step 5: Data Versioning and Storage

#### Version the Dataset

Assign a version number to every custom dataset. Use semantic versioning: `v1.0.0` for the initial release, increment the minor version for additions, increment the major version for breaking changes (schema changes, re-splitting).

Document how the dataset was constructed so it can be reconstructed:

```
Dataset version: v1.0.0
Construction date: 2026-05-08
Construction script: scripts/build_dataset.py
Raw data sources:
  - source_a: 50,000 examples from [URL] (collected 2026-05-01)
  - source_b: 30,000 examples from [API] (collected 2026-05-02)
Preprocessing: scripts/preprocess.py (commit abc123)
Split: scripts/split.py --seed 42 --train 0.8 --val 0.1 --test 0.1
```

#### Storage Location

- **Raw data**: `data/raw/` — the untouched source data. Never modify files in this directory.
- **Processed data**: `data/processed/` — the output of the preprocessing pipeline. This is what the training code reads.
- **Splits**: `data/splits/` — the split definition files.
- **All of `data/` is gitignored**. The data itself is not tracked in git. Only the split definition files and construction scripts are tracked.

Document the paths in the plan `.md` so the experiment phase knows where to find data.

#### License Compliance

- **Verify licenses**: Check the license for every data source. Common licenses: CC-BY (requires attribution), CC-BY-SA (requires attribution and share-alike), CC0 (no restrictions), Apache 2.0 (permissive with patent grant), custom (read the terms).
- **Document licenses**: List the license for each source in the plan `.md`. If a source has no clear license, flag it as a risk.
- **Restricted data**: If using data that requires access credentials (e.g., medical data behind a data use agreement), document the access procedure. Do not commit credentials or restricted data to git.
- **Derivative works**: If your dataset is derived from licensed sources, your dataset inherits the most restrictive license among its sources. A CC-BY-SA source forces your dataset to be CC-BY-SA.

---

## Common Pitfalls

### Insufficient Data for Model Scale

Larger models need more data. A 7B-parameter model fine-tuned on 1,000 examples will overfit — the model memorizes the training set rather than learning generalizable patterns. Symptoms: near-zero training loss, validation loss that increases while training loss decreases, test performance far below validation performance.

Prevention: estimate data requirements from published work using similar model scales. If your dataset is smaller than what comparable work used, either collect more data, use a smaller model, or apply aggressive regularization (dropout, weight decay, early stopping) and acknowledge the limitation.

### Test Set Leakage

Using test data for anything other than the final evaluation invalidates the test set. Common leakage paths:
- Tuning hyperparameters based on test performance
- Selecting the best checkpoint using test loss
- Filtering or preprocessing data using statistics from the full dataset (including test)
- Using test examples in few-shot prompts during development
- Iteratively refining the method based on test results

The test set is a one-shot resource. If you look at test results and then change anything, you must collect a new test set.

### Imbalanced Splits

Random splits on small datasets can produce unrepresentative distributions. A random 80/10/10 split of a 100-example dataset with 10 classes may leave some classes entirely absent from validation or test.

Prevention: use stratified splitting. Verify class distributions across splits. For datasets with < 100 examples per class, consider cross-validation.

### Ignoring Data Quality

Noisy labels, duplicate examples, and formatting inconsistencies degrade model performance more than most architectural improvements. A 1% improvement from a better architecture is easily wiped out by 5% label noise.

Prevention: invest in data quality before investing in model complexity. Run the cleaning pipeline and inspect filtered examples. If the cleaning pipeline removes >20% of data, investigate whether the filters are too aggressive or the raw data is genuinely low-quality.

### Not Documenting Preprocessing

Undocumented preprocessing makes results irreproducible. If a filter threshold, normalization parameter, or augmentation setting is not recorded, no one — including you — can reproduce the experiment six months later.

Prevention: every preprocessing step goes into the plan `.md` or a version-controlled preprocessing script. The script is the documentation.

### Ignoring Data Contamination from Pre-Training

If the model backbone was pre-trained on a corpus that includes your test data, the model may have memorized test examples. This inflates performance and invalidates comparisons — you are measuring memorization, not generalization.

Prevention: check the pre-training data cutoff date against the release date of your test data. If your test data was publicly available before the cutoff, flag the risk. For widely-used benchmarks (MMLU, GSM8K, HumanEval), assume contamination and check for specific evidence (e.g., the model reproducing test examples verbatim).

### Using Different Splits Across Experiments

If experiment A uses one random split and experiment B uses another, their results are not comparable. Differences in performance may be due to split variance, not method differences.

Prevention: generate splits once, save them to `data/splits/`, and use the same split files for all experiments. Commit the split files to git.

---

## Dataset Documentation Template

For the plan `.md`, document every dataset in this format. One section per dataset.

```
### Dataset: [Name]
- **Source**: [URL, API endpoint, or construction methodology. Include collection dates.]
- **Size**: [train/val/test counts. Include per-class counts if classification.]
- **Format**: [Schema description. Include field names, types, and an example.]
- **Preprocessing**: [Step-by-step pipeline with thresholds and rationale.]
- **Split methodology**: [How splits were created — method, seed, stratification, group constraints.]
- **License**: [License type and compliance notes. Flag any restrictions or uncertainties.]
- **Storage**: [Path in project directory, e.g., data/processed/dataset_v1/.]
- **Version**: [Dataset version number and date.]
- **Construction script**: [Path to the script that builds this dataset, e.g., scripts/build_dataset.py.]
- **Known issues**: [Quality concerns, biases, edge cases not covered, contamination risks.]
```

### Example

```
### Dataset: MedicalQA-Specialist
- **Source**: Collected from three medical Q&A forums (MedHelp, AskDoctors, HealthTap)
  via API scraping, 2026-04-15 to 2026-04-20. Filtered to questions with verified
  physician answers only.
- **Size**: train=8,000, val=1,000, test=1,000. 12 medical specialty classes,
  minimum 500 examples per class in train.
- **Format**: JSONL. Fields: id (str), question (str), answer (str), specialty (str),
  difficulty (str: "basic"/"intermediate"/"advanced"), tokens_question ([int]),
  tokens_answer ([int]).
- **Preprocessing**:
  1. Exact dedup by (question, answer) hash → removed 1,200 duplicates
  2. Length filter: questions 20–500 chars, answers 50–2000 chars → removed 800
  3. Language detection: keep only English (langdetect confidence > 0.9) → removed 300
  4. PII scrubbing: redact emails, phone numbers, names → no examples removed
  5. Tokenization: BioBERT tokenizer, max_length=512, truncate from right
- **Split methodology**: Stratified random split by specialty and difficulty,
  seed=42, 80/10/10. Split files saved to data/splits/medicalqa/.
- **License**: CC-BY-NC (forum terms of service permit research use, prohibit
  commercial use). Attribution required in paper.
- **Storage**: data/processed/medicalqa_v1.0.0/
- **Version**: v1.0.0 (2026-05-01)
- **Construction script**: scripts/build_medicalqa.py
- **Known issues**: Physician answers vary in detail level (some are 2 sentences,
  others are 2 paragraphs). Specialty distribution is skewed toward general medicine
  (35% of examples). Test data was publicly available before BioBERT's training
  cutoff — contamination risk is low (forum data unlikely in pre-training) but
  cannot be ruled out.
```

---

## Integration with the Method-Spec Workflow

### When to Execute Each Step

| Step | When | Output |
|------|------|--------|
| Step 1: Data Requirements | During Step 2 (Concretize the Method) of method-spec, when defining the training recipe | Data requirements section in plan `.md` |
| Step 2: Source Identification | After requirements are defined, before writing the full proposal | Source list with evaluation |
| Step 3: Preprocessing Design | During proposal writing (Step 4 of method-spec) | Preprocessing pipeline in plan `.md` |
| Step 4: Split Design | During proposal writing (Step 4 of method-spec) | Split definition files + documentation |
| Step 5: Versioning and Storage | After proposal is approved (Step 9 of method-spec), before experiment phase | Dataset on disk, paths in plan `.md` |

### Tool Interactions

- Use `research_wiki(action="ingest_paper")` to register dataset papers found during source identification.
- Use `research_wiki(action="link")` to connect dataset papers to the plan.
- Document data requirements in the plan `.md` under the "Training Plan" and "Data Requirements" sections.
- The experiment phase reads the plan `.md` to find data paths and preprocessing instructions.
- If data collection requires compute (scraping, synthetic generation), register it as an experiment with `group="sanity"` and `backend="local"` or `backend="api"`.

### Handoff to Experiment Phase

Before advancing to the experiment phase, verify:
- [ ] All data sources are identified and accessible
- [ ] Preprocessing pipeline is documented with thresholds
- [ ] Splits are generated and saved to `data/splits/`
- [ ] Data paths are documented in the plan `.md`
- [ ] Licenses are checked and documented
- [ ] Known issues and contamination risks are flagged
- [ ] The dataset is large enough for the model scale (justified with evidence)

If any of these are incomplete, do not advance. The experiment phase cannot fix data problems — it can only run experiments on whatever data exists.
