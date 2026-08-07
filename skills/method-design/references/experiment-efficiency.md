# Experiment Efficiency


## Parallel-by-Default Principle

Assume every experiment runs in parallel with every other experiment unless a dependency forces sequential execution. Before submitting any experiment, ask: "What else can run at the same time?"

Sequential execution is the exception, not the norm. When you submit experiments one at a time while others could run concurrently, you are burning wall-clock time for no reason. A 10-experiment matrix that takes 2 hours per experiment costs 20 hours sequentially and 2 hours in parallel. The difference is not marginal — it determines whether the experiment phase completes in a day or a week.

### What Can Always Run in Parallel

**Independent experiments.** Different methods, different datasets, different hyperparameter configurations that do not depend on each other's results. If experiment B does not read any output from experiment A, they are independent.

**Multiple seeds.** All seeds of the same experiment configuration. Seeds are independent by definition — each seed is a separate random initialization with no data dependency on other seeds. Submit all seeds simultaneously.

**Data preprocessing.** Run in background while designing or submitting other experiments. Preprocessing is CPU-bound and does not consume GPU quota. Use `nohup` for local preprocessing or `CPU资源空间` (priority 1-3, free tier) for platform preprocessing.

**API calls.** Batch multiple calls or dispatch them concurrently. Most research APIs (Semantic Scholar, arXiv, CrossRef) support concurrent requests. Dispatch multiple scholar subagents in parallel when surveying.

**Subagent dispatches.** Scholar, scout, critic, methodologist, auditor, inspector — all run in parallel when their inputs are independent. A survey that dispatches 3 scholars sequentially takes 3× the time of dispatching them simultaneously.

**Evaluation on completed checkpoints.** Once training produces a checkpoint, evaluation can run in parallel with other training jobs. Evaluation is typically CPU-bound or single-GPU and does not interfere with training.

### What Must Run Sequentially

**Downstream dependencies.** Experiments where later experiments depend on earlier results. Sanity checks must pass before main experiments. Baseline results inform method configuration. Ablation design depends on which components the main results show are important.

**Code changes between experiments.** If experiment B requires code changes based on experiment A's results, they must be sequential. The code must be committed, the change understood, and the new code verified before B can run.

**Resource constraints.** If GPU quota limits concurrent jobs, prioritize the most critical experiments. A quota of 2 concurrent GPUs with 8 experiments means 4 sequential waves. Order waves to put the highest-priority experiments in the earliest waves.

**Shared mutable state.** If two experiments write to the same directory, file, or database without isolation, they conflict. Avoid this by design — give each experiment its own output directory, log file, and checkpoint path. Shared state that forces sequential execution is a design flaw, not a constraint.

### Parallel Execution Patterns

**Pattern A — Independent batch.** Submit all independent experiments simultaneously. Set one `agenda_watch` per experiment. Collect results as they complete. Use when all experiments in a group are mutually independent.

```
# Submit all seeds simultaneously
inspire_submit(name="exp_007-seed42", command="...")
inspire_submit(name="exp_007-seed123", command="...")
inspire_submit(name="exp_007-seed456", command="...")

# Set independent watches
agenda_watch(title="Monitor exp_007-seed42", delay="2h", prompt="...")
agenda_watch(title="Monitor exp_007-seed123", delay="2h", prompt="...")
agenda_watch(title="Monitor exp_007-seed456", delay="2h", prompt="...")
```

**Pattern B — Staged parallel.** Submit stage 1 experiments. While they run, prepare stage 2 code and configs. When stage 1 completes, immediately submit stage 2. Use when stage 2 depends on stage 1 results but stage 2 preparation can happen in parallel with stage 1 execution.

```
# Stage 1: submit sanity + baselines
inspire_submit(name="exp_001-sanity", command="...")
inspire_submit(name="exp_002-baseline", command="...")

# While stage 1 runs: prepare stage 2 configs
# (edit configs, write ablation scripts, preprocess data)

# When stage 1 completes: immediately submit stage 2
inspire_submit(name="exp_003-main-seed42", command="...")
inspire_submit(name="exp_003-main-seed123", command="...")
```

**Pattern C — Background work.** While experiments run, perform work that does not require experiment results. Preprocess data for the next batch. Analyze partial results from completed experiments. Draft paper sections that do not depend on results (related work, method description). Survey additional literature.

**Pattern D — Cross-group parallelism.** Different experiment groups that are independent can run in parallel. Sanity checks for method variant A can run simultaneously with sanity checks for method variant B. Baseline reproduction on dataset X can run simultaneously with baseline reproduction on dataset Y.

### Parallelism Anti-Patterns

**Waiting for all experiments in a batch before starting the next batch.** If 3 of 5 experiments complete and the remaining 2 are independent of the next batch, start the next batch immediately. Do not wait for stragglers.

**Submitting experiments one at a time because "it's simpler."** Simplicity in submission does not justify 5× wall-clock time. The overhead of parallel submission (multiple `inspire_submit` calls, multiple watches) is negligible compared to the time saved.

**Running evaluation sequentially after all training completes.** Evaluate each checkpoint as soon as it is produced. If training job A finishes before training job B, evaluate A's checkpoint while B continues training.

---

## Experiment Ordering

### Priority Order

Execute experiments in this order to fail fast and conserve resources:

1. **Sanity checks.** Verify the environment, data loading, and basic method functionality. A sanity check is the smallest experiment that exercises the full pipeline — one epoch, one seed, minimal data. If sanity fails, fix before spending GPU hours on anything else. A failed sanity check that costs 5 GPU-minutes saves the 50 GPU-hours that would have been wasted on full experiments.

2. **Baselines.** Establish comparison points. Reproduce the strongest published baselines under your evaluation protocol. If baselines cannot be reproduced, the evaluation framework is broken — fix it before running method experiments. If baselines reproduce but produce different numbers than reported, document the discrepancy and its cause.

3. **Main experiments.** Core method results. These are the experiments that directly test the contribution claims. Run with the full configuration: complete training, all seeds, primary datasets.

4. **Ablations.** Isolate component contributions. Only run after main results confirm the method works. If the main method does not beat baselines, ablations are meaningless — you would be measuring the contribution of components in a method that does not work.

5. **Robustness and stress tests.** Optional experiments that strengthen the paper but are not required for the core contribution. Vary conditions (dataset, scale, hyperparameters), test failure boundaries. Run only if time and budget permit after the sufficient set is complete.

### Kill Set Priority

Experiments in the kill set (defined in the plan) must run first within their group. The kill set is the minimum set of experiments whose collective failure means the method does not work. If any kill set experiment fails, stop and reassess — do not waste resources on experiments that depend on a failed premise.

Before submitting non-kill-set experiments, verify that all kill set experiments have passed. If a kill set experiment is still running, wait for it. If it failed, escalate to the user before proceeding.

### Ordering Within a Group

Within a group where all experiments are independent, order by:

1. **Fastest first.** Short experiments complete quickly and provide early signal. If a 30-minute experiment reveals a bug, you learn it in 30 minutes instead of 12 hours.

2. **Highest variance first.** Experiments with uncertain outcomes (new method variant, untested configuration) should run before experiments with predictable outcomes (reproducing a known result). Surprises should surface early.

3. **Highest impact first.** If budget is tight, the experiment that would most strengthen the paper runs before the experiment that would be nice to have.

### When to Skip Ordering

If all experiments in a group are independent and you have sufficient quota to run them all simultaneously, ordering within the group is irrelevant — submit everything at once. Ordering matters only when sequential execution is forced by dependencies or resource constraints.

---

## Monitoring Design

### Agenda Watch Protocol

For every submitted experiment that runs longer than 5 minutes, set a watch. Never submit an experiment and forget about it. An unmonitored experiment is a black box — you will not know it failed until you remember to check, by which point hours of GPU time may be wasted.

```
agenda_watch(
  title="Check exp_XXX",
  delay="[estimated_runtime]",
  prompt="Check experiment exp_XXX status via inspire_jobs or process log.
          If completed: collect results and record via research_experiment(complete).
          If failed: diagnose via inspire_logs and record via research_experiment(fail).
          If still running: check GPU utilization via inspire_metrics, set another watch.")
```

**Watch interval calibration.** Match the watch interval to the experiment duration:

| Experiment duration | Watch interval | Rationale |
|---|---|---|
| < 15 minutes | 5 minutes | Short experiments need frequent checks; the overhead is low |
| 15 min – 1 hour | 15 minutes | Balance between responsiveness and attention cost |
| 1 – 6 hours | 30–60 minutes | Long enough to make progress between checks |
| 6 – 24 hours | 2–4 hours | Checking hourly for a day-long experiment wastes attention |
| > 24 hours | 4–8 hours | Very long experiments; check at natural boundaries (overnight, morning) |

**Watch interval adjustment.** If an experiment consistently completes faster than estimated, shorten the watch interval for subsequent experiments of the same type. If it consistently runs longer, lengthen the interval. The first experiment of a new type establishes the baseline; adjust from there.

**Multiple experiments.** Set one watch per experiment. Each watch fires independently. When woken by a watch, check only the experiment that triggered it — do not re-check all experiments unless you have reason to believe their status changed.

**Watch chaining.** When a watch fires and the experiment is still running, set a new watch with the same delay. Do not set a recurring schedule (`agenda_schedule` with `type: "every"`) — that creates a new agent session on every tick, wastes tokens, and does not auto-stop when the experiment completes.

### Health Monitoring

For running experiments, periodically check health — not just status. A job with status "running" may be stuck, idle, or producing garbage output.

**GPU utilization.** Check via `inspire_metrics(job_id="...", time_range="15m", mode="summary")`.

| Utilization | Assessment | Action |
|---|---|---|
| > 80% | Healthy | No action |
| 50–80% | Acceptable | Monitor; may indicate I/O bottleneck |
| 20–50% | Concerning | Check for data loading bottleneck, small batch size, or inefficient code |
| < 20% sustained (> 15 min) | Critical | Job may be stuck. Check logs. If truly idle, stop and diagnose. |

On some platforms, sustained low GPU utilization triggers automatic preemption. A job that appears "running" at 0% utilization will be killed by the platform — preempt it yourself first to save the checkpoint.

**Memory usage.** Monitor VRAM consumption. If usage exceeds 90% of available VRAM, the job is at risk of OOM. If usage is steadily climbing, OOM is imminent. Preempt and reduce batch size before the platform kills the job — a clean stop preserves the checkpoint; an OOM kill may not.

**Loss trajectory.** Check the most recent loss values from logs. A healthy loss curve decreases smoothly. Warning signs:

- **Plateaued for > 20% of total steps.** Learning rate may be too low or the model may have converged prematurely.
- **Oscillating with high amplitude.** Learning rate may be too high.
- **NaN or Inf.** Immediate critical failure. Stop the job. See `references/auto-retry.md` for NaN recovery.
- **Increasing after decreasing.** Possible overfitting or learning rate schedule issue.

**Output recency.** Check the timestamp of the most recent log line. If no output for > 10 minutes on a job that normally produces output every few seconds, the process may be hung. If no output for > 30 minutes, the process is almost certainly hung — stop and diagnose.

**Training speed.** Compare steps-per-second against expectations. A significant slowdown ( > 50% of expected) may indicate a data loading bottleneck, disk I/O contention, or a misconfigured distributed training setup.

### Initial Health Check

Immediately after submission, perform a rapid health check on every job:

1. Wait 2–3 minutes for the job to start and produce initial output.
2. Check `inspire_logs(job_id="...", lines=20)` for startup errors (missing packages, wrong CUDA version, data path errors).
3. Check `inspire_metrics(job_id="...", time_range="5m", mode="summary")` for initial GPU utilization.
4. If any job fails the initial check, stop it immediately — do not wait for the watch to fire.

This initial check catches configuration errors that would otherwise waste hours of GPU time before the first watch fires.

---

## Failure Recovery

### Automatic Recovery

For common failures, attempt automatic recovery before marking as failed. See `references/auto-retry.md` for the full classification and recovery protocol. Key rules:

- Maximum 2 automatic retries per failure type. After 2 retries, escalate to the user.
- Each retry is a new experiment record linked to the original via notes.
- Record the failure reason and retry action in both the original and retry experiments.
- Never retry silently — log every retry in the timeline.

### Manual Diagnosis

If automatic recovery fails or the failure type is unknown:

1. Download logs: `inspire_logs(job_id="...", download=true, download_path="logs/exp_XXX_crash.log")`.
2. Search for error patterns: `grep -i "error\|exception\|nan\|killed\|oom\|traceback" logs/exp_XXX_crash.log`.
3. Read the last 100 lines of output for context around the failure.
4. Classify the failure:
   - **Environmental.** Missing package, wrong CUDA version, data path error, image mismatch. Fix the environment and resubmit.
   - **Algorithmic.** Diverging loss, zero gradients, vanishing activations. Diagnose the method — this may require a return to spec phase.
   - **Resource.** OOM, preemption, quota exhaustion. Adjust resource configuration and resubmit.
   - **Code bug.** Logic error, shape mismatch, indexing error. Fix the code, commit, and resubmit.

### Failure Recording

Every failure must have a recorded root cause and lesson learned. A failed experiment without documentation is wasted compute — the GPU hours are gone and no knowledge was gained.

```
research_experiment(action="fail", id="exp_XXX",
  failure_reason="OOM at step 8000: activation memory spike in layer 28",
  notes="Root cause: batch_size=128 exceeds 40GB VRAM during backward pass.
         Fix: reduce to batch_size=64 or enable gradient checkpointing.
         Will retry as exp_YYY.")
```

Record in the timeline for cross-experiment visibility:

```
research_timeline(action="append_free_event", event_type="decision",
  summary="Auto-retry: exp_XXX OOM → exp_YYY with bs=64",
  event_refs=["exp_XXX", "exp_YYY"])
```

### Failure Patterns and Systemic Diagnosis

When multiple experiments fail with the same pattern, the problem is systemic, not per-experiment. Do not fix each experiment individually — fix the root cause once.

**Multiple OOMs across different experiments.** The batch size is too high for the available GPU. Reduce globally, not per-experiment.

**Multiple NaN losses.** The learning rate is too high or the loss function has a numerical stability issue. Fix the training recipe.

**Multiple preemptions.** The priority is too low for the chosen compute group. Increase priority or switch to a less contended group.

**Multiple data path errors.** The data path in the command template is wrong. Fix the template, not each experiment.

---

## Resource Budgeting

### GPU-Hour Tracking

Track GPU consumption against the plan's budget estimate. After each experiment completes, compare actual GPU-hours to estimated. If actual consumption consistently exceeds estimates by > 20%, re-estimate remaining experiments before submitting them.

### Budget Exhaustion Protocol

If the budget is exhausted before the sufficient set is complete:

1. Stop submitting new experiments immediately.
2. Assess what has been completed: which claims are supported, which are not.
3. Prioritize remaining experiments by claim criticality.
4. Options:
   - **Reduce scope.** Narrow claims to what current evidence supports. A paper with narrower but well-supported claims is stronger than a paper with broad, unsupported claims.
   - **Use free tier.** Submit remaining experiments to `CPU资源空间` (priority 1-3, free) if they are CPU-bound.
   - **Wait for budget refresh.** If budget refreshes on a known schedule (quarterly for 导师项目, weekly for 公共科研项目), pause and resume when budget is available.
   - **Escalate to user.** Present the situation: what is complete, what is missing, what the options are.

### Quota-Constrained Parallelism

When GPU quota limits concurrent jobs, maximize throughput within the constraint:

1. **Fill the quota.** If quota is 2 concurrent GPUs, always have 2 jobs running. When one completes, immediately submit the next.
2. **Queue locally.** Register all experiments and maintain a submission queue. When a slot opens, submit the highest-priority queued experiment.
3. **Prefer shorter jobs for queue slots.** A 1-hour job that blocks a slot delays the next experiment by 1 hour. A 12-hour job delays it by 12 hours. If you have a mix of short and long experiments, run short experiments first to maximize slot turnover.

---

## Common Pitfalls

**Running experiments sequentially when they could be parallel.** The most common and most expensive efficiency loss. Before submitting any experiment, explicitly list what else could run concurrently. If the list is non-empty and you are not submitting those experiments, justify why.

**Not setting watches.** Submitting an experiment and forgetting about it. A job that fails 10 minutes in and sits idle for 6 hours wastes 5 hours and 50 minutes of GPU time. Always set an `agenda_watch`.

**Watching too frequently.** Polling every 5 minutes for a 12-hour experiment wastes context and attention. Match watch interval to experiment duration. A watch that fires 144 times for one experiment is a design error.

**Not checking GPU utilization.** A job with status "running" may be stuck at 0% GPU utilization. Status alone is not health. Monitor utilization, loss trajectory, and output recency.

**Retrying without changing anything.** If an experiment fails, blindly resubmitting with the same configuration will fail again. Diagnose the root cause before retrying. If you cannot identify the cause, escalate — do not retry.

**Not recording failure analysis.** A failed experiment without documentation is wasted compute. Every failure must have a recorded root cause and lesson learned. Future you (or another agent) should be able to read the failure record and understand what happened without re-deriving it from raw logs.

**Submitting all experiments before any complete.** If you submit 20 experiments simultaneously and the first one to complete reveals a fundamental bug, the other 19 are running with the same bug. For large batches, submit a canary — one representative experiment — and wait for it to pass initial health checks before submitting the rest.

**Ignoring the kill set.** Submitting non-kill-set experiments while kill set experiments are still running or have failed. If the kill set fails, everything else is wasted. Always verify kill set status before expanding the experiment batch.

**Treating all experiments as equal priority.** A robustness test on a third dataset does not have the same priority as the main result on the primary dataset. When resources are constrained, cut low-priority experiments, not high-priority ones.

**Not adjusting estimates.** If the first experiment takes 3 hours instead of the estimated 2, the remaining 9 experiments will take 27 hours, not 18. Update the timeline and inform the user. Do not let estimate drift accumulate silently.

**Running evaluation at the end.** Evaluation can and should run in parallel with training. When training job A produces a checkpoint, evaluate it immediately while training job B continues. Deferring all evaluation to the end adds unnecessary wall-clock time.
