# Training Design


## Training Recipe Design

### Step 1: Define the Optimization Setup

Specify every component of the training loop. No defaults are assumed — every value must be explicit and justified.

#### Optimizer

AdamW is the default for transformer training. Specify:

- `lr`: peak learning rate
- `betas`: (β₁, β₂) — default (0.9, 0.999) for most tasks; reduce β₂ to 0.98 or 0.95 for unstable training
- `eps`: 1e-8 for fp32, 1e-5 for mixed precision (prevents underflow in fp16)
- `weight_decay`: 0.01–0.1 for most transformer tasks; 0 for bias and LayerNorm parameters (explicitly exclude them)

Deviations from AdamW require justification:

| Optimizer | When to use | Key difference |
|-----------|-------------|----------------|
| SGD + momentum | Small CNNs, legacy baselines | No adaptive per-parameter LR; needs careful LR tuning |
| Adam (no decoupled WD) | Legacy codebases | Weight decay couples with LR schedule; avoid for new work |
| Lion | Large-batch training, memory-constrained | Sign-based updates; often needs higher LR than AdamW |
| Adafactor | Memory-constrained (no AdamW states fit) | Factorized second moments; may converge slower |
| Sophia / SophiaH | Pre-training with limited budget | Second-order clipped updates; 2x faster in some regimes |

#### Learning Rate Schedule

Specify the full schedule:

- **Type**: constant, linear decay, cosine decay, cosine with restarts, inverse sqrt, or warmup-then-constant
- **Peak LR**: the maximum learning rate reached after warmup
- **Warmup steps**: linear warmup from 0 to peak LR. Typical: 5–10% of total steps. For large models (>1B params), use 1–3% of total steps
- **Min LR**: final learning rate as a fraction of peak LR. Cosine decay: 0 or 1e-7. Linear decay: 0. For constant: same as peak LR
- **Total steps**: total training steps (not epochs). Compute as `len(dataset) / effective_batch_size × epochs`

For multi-stage training, specify a separate schedule per stage.

#### Batch Size

Define three values:

- **Per-device batch size**: samples per GPU per forward pass
- **Gradient accumulation steps**: number of forward passes before one optimizer step
- **Effective batch size**: `per_device_batch_size × accumulation_steps × num_gpus`

Larger effective batch sizes generally require higher learning rates. The relationship is approximately linear for small batch sizes and sub-linear for large ones. Use the square-root scaling rule as a starting point: `lr_new = lr_base × sqrt(batch_new / batch_base)`.

Batch size interacts with BatchNorm/LayerNorm statistics. When per-device batch size is very small (< 8), BatchNorm statistics become unreliable — switch to GroupNorm or LayerNorm, or use SyncBN across GPUs.

#### Mixed Precision

| Precision | Hardware requirement | Stability | When to use |
|-----------|---------------------|-----------|-------------|
| fp32 | Any GPU | Highest | Debugging, small models, numerical verification |
| fp16 | Volta+ (V100, T4) | Lower — risk of overflow/underflow | Legacy hardware, memory-constrained |
| bf16 | Ampere+ (A100, H100, 4090) | High — same exponent range as fp32 | Default for modern hardware |
| fp8 | Hopper+ (H100, H200) | Requires TE/TransformerEngine | Large-scale pre-training only |

bf16 is preferred on supported hardware. It eliminates the need for loss scaling and reduces the risk of silent underflow in gradient computation.

Operations that must stay in fp32 regardless of mixed precision setting:
- Loss computation and reduction
- Softmax (numerically sensitive)
- Normalization layers (LayerNorm, RMSNorm)
- Embedding layer output (if using fp16; bf16 is usually safe)

#### Gradient Clipping

Specify `max_grad_norm`. Typical values:

| Scenario | max_grad_norm |
|----------|---------------|
| Stable pre-training (bf16, moderate LR) | 1.0 |
| Fine-tuning with high LR | 0.5–1.0 |
| Unstable training (spikes in grad norm) | 0.1–0.5 |
| RNN/LSTM training | 0.25–1.0 |
| RL-based training | 0.5 |

Monitor gradient norm in logs. If it consistently hits the clip threshold, the learning rate is too high or the loss function has numerical issues.

---

### Step 2: Define the Loss Function

#### Primary Loss

Specify the exact loss computation, including reduction method:

- **Classification**: cross-entropy with `reduction='mean'`. For class imbalance, use weighted cross-entropy with inverse-frequency weights
- **Generation / next-token prediction**: cross-entropy over vocabulary, averaged over non-padding tokens. Use `ignore_index` to mask padding
- **Regression**: MSE for unbounded outputs, Huber (smooth L1) for robustness to outliers
- **Contrastive**: InfoNCE with temperature parameter τ. Typical τ ∈ [0.07, 0.5]. Larger τ → softer distribution, smaller τ → harder negatives
- **Binary classification / multi-label**: BCEWithLogitsLoss (numerically more stable than sigmoid + BCE)

#### Auxiliary Losses

Each auxiliary loss must have an explicit weight relative to the primary loss:

```
total_loss = primary_loss + λ₁ × aux_loss₁ + λ₂ × aux_loss₂ + ...
```

Document the purpose of each auxiliary loss and its weight:

| Auxiliary loss type | Typical λ range | Purpose |
|---------------------|-----------------|---------|
| Knowledge distillation | 0.1–1.0 | Transfer from teacher to student |
| Contrastive (auxiliary) | 0.01–0.5 | Representation learning alongside primary task |
| L1/L2 regularization | 1e-5–1e-3 | Weight sparsity or smoothness |
| Consistency / invariance | 0.1–1.0 | Enforce prediction stability under augmentation |
| Auxiliary task head | 0.1–0.5 | Multi-task learning with a secondary objective |

If an auxiliary loss weight is tuned, document the tuning range and the selected value.

#### Loss Masking

Define which tokens, samples, or positions are excluded from loss computation:

- **Padding tokens**: use `ignore_index` in cross-entropy (PyTorch) or equivalent
- **Prompt tokens in generation**: compute loss only on the completion/response portion, not the input prompt
- **Invalid or corrupted samples**: skip entire samples if they fail validation checks
- **Special tokens**: exclude BOS, EOS, SEP, or other control tokens from loss
- **Class-imbalanced masking**: for dense prediction tasks, mask dominant classes to prevent loss domination

Document the masking strategy precisely — a missing mask is a common source of silently incorrect training.

---

### Step 3: Define Training Stages

Multi-stage training is common when different components require different optimization schedules or when curriculum learning is used.

#### Stage Specification

For each stage, document:

1. **What is trained**: which parameters are unfrozen (all, specific layers, LoRA adapters, head only)
2. **What is frozen**: backbone, embedding layer, normalization statistics
3. **Data**: which dataset split or subset is used
4. **Duration**: number of steps or epochs
5. **Learning rate**: peak LR for this stage (may differ from other stages)
6. **Batch size**: may change between stages (e.g., larger batch for frozen-backbone stage)
7. **Loss weights**: auxiliary loss weights may change between stages

#### Stage Transition Criteria

Define when to move from one stage to the next:

- **Fixed steps**: transition after N steps regardless of metrics. Simplest, most common
- **Validation metric threshold**: transition when validation loss or accuracy reaches a target. Requires monitoring
- **Plateau detection**: transition when validation metric stops improving for K consecutive evaluations
- **Manual**: user decides when to transition. Only for exploratory work

#### Common Stage Patterns

| Pattern | Stage 1 | Stage 2 | Stage 3 |
|---------|---------|---------|---------|
| Head then full | Train new head only (frozen backbone) | Unfreeze all, lower LR | — |
| Curriculum | Easy subset, standard LR | Full dataset, standard LR | Hard subset, lower LR |
| Distill then fine-tune | Distillation loss only | Task loss only (or mixed) | — |
| Pre-train then adapt | Large generic dataset | Task-specific dataset | — |
| LoRA then merge | Train LoRA adapters | Merge + optional full fine-tune | — |

---

### Step 4: Define Checkpointing and Logging

#### Checkpointing

- **Frequency**: save every N steps. For runs < 10K steps, save every 500–1000 steps. For runs > 100K steps, save every 5000–10000 steps. Always save at stage boundaries
- **Retention**: keep the best-K checkpoints by validation metric. K = 3 for most projects, K = 5 for critical long runs. Delete older checkpoints to save disk space
- **Contents**: save model weights, optimizer state, scheduler state, random number generator state, and current step/epoch. Include the full training config in the checkpoint metadata
- **Format**: use safetensors for model weights (safe, fast, framework-agnostic). Avoid pickle-based formats (.pt, .pth) for production training
- **Validation**: after saving, verify the checkpoint loads correctly by running a single forward pass. A corrupted checkpoint discovered after a crash is worthless

#### Logging

Log the following at every logging interval (typically every 10–100 steps):

- **Loss**: primary loss, each auxiliary loss, total loss
- **Learning rate**: current LR (catches scheduler bugs early)
- **Gradient norm**: total norm and per-parameter-group norm
- **Throughput**: samples per second, tokens per second
- **GPU metrics**: memory allocated, memory reserved, utilization (if available)
- **Validation metrics**: evaluate on validation set at regular intervals (every 500–2000 steps or every epoch)

Log format: structured JSON lines. Each line is a self-contained JSON object with timestamp, step, and all metrics. This format is parseable by any tool and does not require a specific logging platform.

```json
{"timestamp": "2026-05-08T12:00:00Z", "step": 1000, "train/loss": 2.34, "train/lr": 5e-5, "train/grad_norm": 1.2, "val/loss": 2.51, "val/ppl": 12.3}
```

#### Resumption

Training must be resumable from the latest checkpoint. Before starting any run longer than 1 hour:

1. Run training for 10 steps
2. Kill the process
3. Resume from the saved checkpoint
4. Verify loss and metrics continue from the same values (within numerical tolerance of 1e-4)
5. If resumption fails, fix it before launching the full run

Common resumption bugs:
- Data loader shuffle state not restored → different data order after resume
- Learning rate scheduler not restored → LR jumps to initial value
- Random seed not checkpointed → different dropout/augmentation after resume
- Batch normalization statistics not in checkpoint → running mean/var reset

---

## Infrastructure Design

### Step 5: Compute Planning

#### GPU Selection

Run `inspire_status()` to discover available GPU types. Select based on:

1. **VRAM requirement**: model weights + optimizer states + gradients + activations must fit in GPU memory. Estimate VRAM usage:

| Component | Memory (fp32) | Memory (bf16/fp16 mixed) |
|-----------|---------------|--------------------------|
| Model weights | 4 × params bytes | 2 × params bytes |
| Optimizer states (AdamW) | 8 × params bytes | 8 × params bytes |
| Gradients | 4 × params bytes | 2 × params bytes |
| Activations | batch × seq_len × hidden × layers × factor | Same (stays in fp16/bf16) |
| Total (approximate) | 16–20 × params bytes | 12–16 × params bytes |

For a 7B parameter model in bf16 mixed precision: ~14 GB weights+optimizer+gradients + activations. Activations dominate for long sequences.

2. **GPU count**: more GPUs = faster training but diminishing returns from communication overhead. Rule of thumb: strong scaling efficiency drops below 80% beyond 8–16 GPUs for most workloads without model parallelism

3. **Internet access**: offline spaces (分布式训练空间, 高性能计算) require all dependencies in the Docker image. Online spaces (可上网GPU资源) allow runtime downloads but may have slower network

#### Distributed Training Strategy

| Strategy | When to use | Scaling limit | Code change |
|----------|-------------|---------------|-------------|
| DDP (DistributedDataParallel) | Model fits on one GPU | ~8–16 GPUs | Minimal — wrap model |
| FSDP (FullyShardedDataParallel) | Model too large for one GPU | ~64–128 GPUs | Moderate — sharding config |
| DeepSpeed ZeRO-1/2/3 | Large models, memory-constrained | ~128+ GPUs | Moderate — DeepSpeed config |
| Tensor parallelism | Single model layer too large for one GPU | Within one node (8 GPUs) | Significant — model code changes |
| Pipeline parallelism | Very large models, many GPUs | Across nodes | Significant — pipeline schedule |
| 3D parallelism (TP+PP+DP) | GPT-scale training | Thousands of GPUs | Major — full rewrite |

For most research projects (models < 13B params, ≤ 8 GPUs): DDP or FSDP with ZeRO-2 is sufficient.

Launch command template for multi-GPU:
```bash
torchrun --nproc_per_node=$NUM_GPUS train.py --config configs/main.yaml
```

#### Training Time Estimate

Compute estimated time:

```
steps_per_epoch = len(dataset) / effective_batch_size
total_steps = steps_per_epoch × num_epochs
time_per_step = measured from a short run (100 steps)
total_time = total_steps × time_per_step × overhead_factor
```

Overhead factor: 1.1 for single-GPU, 1.2–1.5 for multi-GPU (communication overhead, stragglers), 1.5–2.0 for pipeline parallelism (bubble overhead).

Add 20–30% buffer for debugging, restarts, and unexpected slowdowns.

---

### Step 6: Environment Reproducibility

#### Docker Image

Build a project-specific image with all dependencies pre-installed. Never install packages at experiment runtime.

Dockerfile requirements:
- Base image: `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime` or equivalent
- Install `uv` for Python package management
- Copy `pyproject.toml` and `uv.lock`, run `uv sync --extra train --frozen`
- Install any system-level dependencies (ffmpeg, git-lfs, etc.)
- Set environment variables: `HF_HOME`, `TORCH_HOME`, `TRANSFORMERS_CACHE` to persistent paths

```dockerfile
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

RUN pip install uv
COPY pyproject.toml uv.lock ./
RUN uv sync --extra train --frozen

ENV HF_HOME=/inspire/hdd/project/${EN_NAME}/.cache/huggingface
ENV TORCH_HOME=/inspire/hdd/project/${EN_NAME}/.cache/torch
```

After building, push and register the image on the platform. Record the image address in `ASSETS.md`.

#### Python Environment

- Use `uv` for dependency management. `pyproject.toml` declares dependencies; `uv.lock` pins exact versions
- Commit both `pyproject.toml` and `uv.lock` to git
- Never use `pip install` directly — always `uv add` to update the lock file
- For local development: `uv sync --extra train` creates `.venv/` with all training deps

#### Random Seeds

Set and document all seeds in a version-controlled config file:

```python
import random
import numpy as np
import torch

SEED = 42

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
torch.cuda.manual_seed_all(SEED)

# For deterministic CUDA operations (may reduce performance):
torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark = False
```

Seeds must be:
- In a config file, not hardcoded in training scripts
- Passed as a CLI argument: `--seed 42`
- Recorded in the experiment's hyperparameters
- Different across experiment runs (seed 42, 123, 456 for main results)

CUDA determinism caveat: `torch.backends.cudnn.deterministic = True` ensures bitwise reproducibility but can significantly slow down training. For most research, set it to `False` and accept minor numerical variation across runs. Only enable it when debugging or when exact reproducibility is required.

---

### Step 7: Failure Recovery

#### Out of Memory (OOM)

OOM errors occur when the GPU cannot allocate memory for a tensor. Recovery options, in order of preference:

1. **Reduce batch size**: halve per-device batch size, double gradient accumulation to maintain effective batch size
2. **Enable gradient checkpointing**: trades compute for memory. Reduces activation memory by ~60% at the cost of ~20% more compute. Use `model.gradient_checkpointing_enable()` for HuggingFace models
3. **Use FSDP/ZeRO**: shard optimizer states and gradients across GPUs. ZeRO-2 is usually sufficient; ZeRO-3 also shards model parameters
4. **Reduce sequence length**: truncate or chunk long sequences. Only if the task permits
5. **Use CPU offloading**: offload optimizer states or parameters to CPU RAM. Significant slowdown (2–5x) but allows training models that otherwise would not fit

Document the maximum batch size that fits in available VRAM for each GPU type. This prevents repeated OOM debugging.

#### NaN Loss

NaN loss indicates numerical instability. Diagnose in this order:

1. **Check learning rate**: if LR is too high, gradients explode → NaN. Reduce LR by 2–10x and retry
2. **Check gradient clipping**: if `max_grad_norm` is not set, set it to 1.0. If already set, reduce to 0.5
3. **Check loss computation**: verify no division by zero, log(0), or sqrt(negative). Add eps to denominators
4. **Check data**: NaN or Inf values in input data. Validate dataset before training
5. **Check mixed precision**: fp16 can underflow to zero in softmax or loss. Switch to bf16 or keep softmax in fp32
6. **Check model initialization**: poor initialization can produce extreme activations. Use standard init schemes (xavier_uniform, kaiming_normal, or the model's default)

Add NaN detection to the training loop:
```python
if torch.isnan(loss):
    raise RuntimeError(f"NaN loss at step {step}. Last valid checkpoint: {last_ckpt}")
```

#### Slow Convergence

If loss decreases slower than expected:

1. **Verify learning rate**: too low → slow convergence. Try 2–5x higher LR
2. **Check warmup**: insufficient warmup can cause early instability that slows convergence. Increase warmup to 10% of total steps
3. **Check data**: mislabeled data, incorrect normalization, or data leakage between train/val
4. **Check loss masking**: if padding tokens are not masked, they dilute the loss signal
5. **Check batch size**: very large batch sizes can slow per-step convergence (though total convergence may be faster in wall-clock time)

#### Hardware Preemption

On shared clusters (Inspire, SLURM), jobs can be killed at any time:

1. **Checkpoint frequency**: save checkpoints frequently enough that losing one interval is acceptable. For runs > 24 hours, save at least every 2–4 hours of training time
2. **Auto-resume**: the training script must detect existing checkpoints and resume automatically. Do not require manual intervention
3. **Inspire-specific**: use `auto_fault_tolerance=true` in `inspire_submit` to enable automatic resubmission on preemption
4. **Disk persistence**: checkpoints must be saved to persistent storage (`/inspire/hdd/project/...`), not to ephemeral container storage

---

## Common Pitfalls

### Not Tuning Learning Rate

The default learning rate from a different model, task, or codebase is unlikely to be optimal. Always run a learning rate sweep before committing to long training runs. A minimal sweep: test 5 values spanning 2 orders of magnitude (e.g., 1e-5, 5e-5, 1e-4, 5e-4, 1e-3). Run for 10–20% of total steps and compare validation metrics.

### Ignoring Batch Size Effects

Batch size interacts with:
- **Learning rate**: larger batch → higher LR needed. Use square-root scaling as a starting point
- **Normalization layers**: BatchNorm statistics degrade with small per-device batch size (< 8). Use GroupNorm or SyncBN instead
- **Gradient noise**: small batches have higher gradient variance, which can act as implicit regularization. Switching to large batches may require explicit regularization (higher weight decay, dropout)

### Training on Insufficient Data

Fine-tuning a large model on a tiny dataset (< 1000 examples) leads to overfitting within a few hundred steps. Mitigations:
- High weight decay (0.1)
- High dropout (0.3–0.5)
- Early stopping based on validation metric
- Data augmentation (if applicable to the modality)
- Use a smaller model variant

### Not Logging Enough Information

When training fails silently, insufficient logs make debugging impossible. At minimum, log: loss (every step), learning rate (every step), gradient norm (every step), validation metrics (every N steps), GPU memory (every step), and throughput (every N steps). Log in structured JSON lines format.

### Not Testing Resumption

A long training run that cannot be resumed wastes days of compute if interrupted. Test resumption before every run longer than 1 hour. The test: train 10 steps, kill, resume, verify identical loss.

### Hardcoding Paths

Never hardcode absolute paths in training scripts. Use:
- Environment variables: `$DATA_DIR`, `$OUTPUT_DIR`, `$HF_HOME`
- CLI arguments: `--data-dir`, `--output-dir`, `--cache-dir`
- Config files: paths in YAML config, overridable via CLI

### Not Versioning Configs

Training configs must be in version control. Every experiment's config must be reconstructible from the git commit recorded in the experiment. If configs are generated dynamically, save the generated config alongside the checkpoint.

---

## Training Documentation Template

In the plan `.md`, document the training design in this format:

```
### Training Configuration
- Optimizer: AdamW, lr=5e-5, weight_decay=0.01, betas=(0.9, 0.999), eps=1e-8
- Schedule: cosine decay, warmup=500 steps, peak_lr=5e-5, min_lr=1e-7, total_steps=10000
- Batch size: 4 per GPU × 4 accumulation × 4 GPUs = 64 effective
- Precision: bf16 mixed, softmax+norm in fp32
- Gradient clipping: max_norm=1.0
- Loss: cross-entropy (primary, weight=1.0) + contrastive (auxiliary, λ=0.1)
- Loss masking: ignore padding tokens (token_id=0), compute loss on completion only
- Stages:
  - Stage 1 (steps 0–2000): train head only, frozen backbone, lr=1e-4
  - Stage 2 (steps 2000–10000): unfreeze all, lr=5e-5

### Infrastructure
- GPU: H200 SXM × 4, 141GB VRAM each
- Distributed: FSDP with ZeRO-2, torchrun launch
- Estimated time: 8 hours per run, 32 GPU-hours total
- Image: docker.sii.shaipower.online/inspire-studio/myproject:v3
- Checkpointing: every 1000 steps, keep best 3 by val/loss
- Logging: JSON lines every 10 steps, validation every 500 steps

### Failure Recovery
- OOM handling: max batch size 8 per GPU (H200). Gradient checkpointing enabled
- NaN handling: gradient clipping at 1.0, NaN detection in training loop
- Preemption handling: checkpoint every 1000 steps (~30 min), auto-resume from latest
- Resumption tested: yes, verified loss continuity within 1e-4 tolerance
```
