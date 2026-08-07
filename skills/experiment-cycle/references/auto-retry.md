# Auto-Retry Protocol — Automated Failure Recovery for Experiments

Load this reference when an experiment fails. Instead of just reporting the failure, attempt automated diagnosis and recovery before escalating to the user.

## Failure Classification and Auto-Recovery

### OOM (Out of Memory)

**Detection**: Log contains `CUDA out of memory`, `RuntimeError: CUDA error`, `Killed` (OOM killer)

**Auto-recovery (up to 2 retries)**:
1. Read the current batch size from experiment hyperparameters
2. Halve the batch size: `batch_size = batch_size // 2`
3. If gradient accumulation is available: double `gradient_accumulation_steps` to maintain effective batch
4. Re-register experiment with modified hyperparameters:
   ```
   research_experiment(action="register",
     title="<original title> (OOM retry, bs=<new_bs>)",
     hyperparameters={..., batch_size: new_bs, gradient_accumulation_steps: new_gas})
   ```
5. Resubmit

**Escalate if**: 2 retries still OOM, or batch size would drop below 1

### NaN / Inf Loss

**Detection**: Log contains `nan`, `inf`, `loss is NaN`, `diverged`

**Auto-recovery (up to 2 retries)**:
1. Reduce learning rate by 10x: `lr = lr * 0.1`
2. Enable gradient clipping if not already: `max_grad_norm = 1.0`
3. Enable loss scaling if mixed precision: `loss_scale = "dynamic"`
4. Re-register and resubmit with modified hyperparameters

**Escalate if**: 2 retries still diverge (likely a method/code bug, not a hyperparameter issue)

### Job Preempted (platform killed the job)

**Detection**: Job status is `stopped` but not by user. Inspire: job status `Preempted`.

**Auto-recovery**:
1. Check if a checkpoint exists at the last saved step
2. If checkpoint exists: resubmit with `--resume_from_checkpoint <path>`
3. If no checkpoint: resubmit from scratch at higher priority (if budget allows)
4. Record in experiment notes: "Preempted at step N, resumed from checkpoint"

**Escalate if**: Preempted 3+ times (priority too low for this queue)

### Stale Process (GPU idle, no output)

**Detection**: GPU utilization < 10% for > 15 minutes, no new log output for > 10 minutes

**Auto-recovery**:
1. Check if the process is in a data loading phase (may be normal for large datasets)
2. If truly stuck: `inspire_stop(job_id="...")` + re-register + resubmit
3. Record: "Job stalled at step N, killed and restarted"

**Escalate if**: Stalls on retry (likely a deadlock or data pipeline issue)

### Import / Environment Error

**Detection**: Log shows `ModuleNotFoundError`, `ImportError`, `conda: command not found`

**Auto-recovery**:
1. Check the command's environment setup:
   - Is `source /opt/conda/etc/profile.d/conda.sh && conda activate` present?
   - Is the correct image being used?
   - For offline spaces: are all dependencies in the image?
2. Fix the command and resubmit

**Escalate if**: The error is in a package that must be pip-installed but the space is offline → need a new image

### Data Path Error

**Detection**: Log shows `FileNotFoundError`, `No such file or directory` for data paths

**Auto-recovery**:
1. Check `ASSETS.md` for correct data paths
2. Check if the path uses the correct project name (en_name)
3. Fix the path in the command and resubmit

**Escalate if**: Data genuinely doesn't exist on the platform → need to upload first

### Image / Workspace Mismatch

**Detection**: Job fails immediately with CUDA errors, driver version mismatch, or `no CUDA-capable device`

**Auto-recovery**:
1. Check which compute group was used — verify it's available via `inspire_status()` (see `references/inspire-compute.md`)
2. Check the image's CUDA version — must match the compute group's CUDA version
3. If using wrong GPU: resubmit to a correct compute group from `inspire_status()` (see `references/inspire-compute.md`)
4. If image CUDA mismatch: rebuild image with common CUDA version (12.4 or 12.8) for cross-GPU compatibility

**Escalate if**: No available GPUs in any compute group → user needs to choose a different resource or wait

## Retry Protocol

### Rules

1. **Maximum 2 automatic retries per failure type**. After 2 retries, escalate to user.
2. **Each retry is a NEW experiment record** — link to the original via notes, not by overwriting.
3. **Record the failure reason and retry action** in the original experiment:
   ```
   research_experiment(action="fail", id="exp_XXX",
     failure_reason="OOM at step 8000, batch_size=128")
   ```
4. **Record the retry link** in the new experiment's notes:
   "Retry of exp_XXX — reduced batch_size from 128 to 64"
5. **Never retry silently** — always log the retry in timeline:
   ```
   research_timeline(action="append_free_event", event_type="decision",
     summary="Auto-retry: exp_XXX OOM → exp_YYY with bs=64",
     event_refs=["exp_XXX", "exp_YYY"])
   ```

### Escalation

When auto-recovery fails or the failure type is unknown:

```
⚠️ Experiment exp_XXX failed and auto-recovery unsuccessful.

Failure: [type]
Attempts: [N]
Last error: [message]

Recommended action:
  - [specific suggestion based on failure type]
  - If method-level issue: consider rollback to spec phase
  - If infrastructure issue: check platform status / image / data
```

## Participation Mode Behavior

- **collaborative**: Report every failure, ask before retrying
- **guided**: Auto-retry OOM/preemption silently, report other failures
- **autonomous**: Auto-retry all known failure types, escalate only unknowns and 2+ retry exhaustion
