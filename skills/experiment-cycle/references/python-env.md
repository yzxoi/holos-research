# Python Environment Management with uv

All Python dependencies in the research project are managed by [uv](https://docs.astral.sh/uv/) — not pip, not conda. This ensures reproducible environments, fast installs, and clean separation between project deps and system Python.

## Why uv

- **Speed**: 10-100x faster than pip
- **Lock file**: `uv.lock` guarantees exact reproducibility across machines
- **Built-in venv**: `uv run` auto-creates and uses `.venv/` — no manual `source activate`
- **Offline support**: `uv sync --no-index` with cached wheels for Inspire offline spaces
- **Minimal images**: Only install what the project needs, not a bloated conda env

## Setup (done by research_init)

`research_init` creates a `pyproject.toml` in the project root:

```toml
[project]
name = "my-research"
version = "0.1.0"
requires-python = ">=3.10"

# Core deps for research utility scripts (stats, plotting, etc.)
dependencies = [
    "matplotlib>=3.8",
    "numpy>=1.26",
]

# Experiment-specific deps — add as needed
[project.optional-dependencies]
train = [
    "torch>=2.2",
    "transformers>=4.40",
    "datasets>=2.19",
    "wandb>=0.17",
]
```

After init:
```bash
uv sync                  # install core deps, creates .venv/
uv sync --extra train    # also install training deps
```

## Running Scripts

**Always use `uv run` instead of `python3`:**

```bash
# Our utility scripts
uv run .research/scripts/stats.py compare --a results/exp_007.json --b results/exp_001.json --metric ppl
uv run .research/scripts/plot.py bar --theme neurips-vivid --data '{"Ours": 18.3}' --output fig.pdf

# Experiment scripts
uv run python train.py --config configs/main.yaml --seed 42

# One-off script
uv run python -c "import torch; print(torch.cuda.is_available())"
```

`uv run` automatically:
- Creates `.venv/` if it doesn't exist
- Installs missing deps from `pyproject.toml`
- Runs the command inside the venv

## Adding Dependencies

```bash
# Add a new dep for everyone
uv add seaborn

# Add a dep only for training
uv add --optional train accelerate

# Add a dep only for development
uv add --dev pytest
```

This updates `pyproject.toml` and `uv.lock`. **Commit both files.**

## Inspire Platform Strategy

### ⚠️ Pre-build only — no runtime installs

**Do NOT install dependencies at experiment runtime.** This is slow, fragile, and fails in offline spaces. ALL Python dependencies must be pre-installed in the Docker image before submission.

**The correct workflow:**
1. Add deps to `pyproject.toml`: `uv add --optional train transformers`
2. Build the image with all deps installed (see Dockerfile below)
3. Push and register the image on the platform
4. Submit experiments using the pre-built image — `uv run` finds everything already installed

### Dockerfile for offline spaces (recommended)

```dockerfile
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

RUN pip install uv
COPY pyproject.toml uv.lock ./
RUN uv sync --extra train --frozen
# All deps are now in the image — no network needed at runtime
```

**If `apt-get install` or `pip install` inside Dockerfile times out** (common on mainland China networks), add mirror configuration before the install lines:
```dockerfile
# apt mirror (for apt-get install in Dockerfile):
RUN sed -i 's|archive.ubuntu.com|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
# pip mirror:
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
# huggingface mirror (for HF downloads in image):
ENV HF_ENDPOINT=https://hf-mirror.com
```
These are optional — only add them if the build fails with download timeouts.

### Building for multiple GPU types

Build ONE image with a CUDA version compatible across all GPUs you use (e.g. 12.4 or 12.8). Do NOT build separate images per GPU type.

**If Docker build fails** (common on shared machines without cgroup access):
```bash
buildah bud --isolation chroot -t myproject:v3 -f Dockerfile .
buildah push myproject:v3 docker://docker.sii.shaipower.online/inspire-studio/myproject:v3
```
Then register via `inspire_image_push`.

### Image management

**Build strategy**: Pre-build one image with ALL project dependencies. Never install deps at experiment runtime. See `references/inspire-compute.md` for the full image building policy (buildah fallback, chroot isolation, multi-GPU-region strategy).

Track the current Docker image in `ASSETS.md`:

```markdown
## Docker Images

| Image | Space | Base | Key packages | Last updated |
|-------|-------|------|-------------|-------------|
| docker.sii.shaipower.online/inspire-studio/myproject:v1 | 分布式训练 | pytorch 2.2 cuda 12.1 | torch, transformers, datasets | 2026-05-15 |
```

**When Docker build fails**: Use buildah with chroot isolation to bypass cgroup permission issues:
```bash
buildah bud --isolation chroot -t myproject:v3 -f Dockerfile .
buildah push myproject:v3 docker://docker.sii.shaipower.online/inspire-studio/myproject:v3
```
Then register via `inspire_image_push`.

## .gitignore

These are already handled by `research_init`'s `.gitignore`:

```
.venv/           # uv virtual environment (recreatable from uv.lock)
__pycache__/     # Python bytecode cache
*.pyc
```

**DO commit**: `pyproject.toml`, `uv.lock` — these are essential for reproducibility.

## Environment in Experiment Records

When registering an experiment, record the environment:

```
research_experiment(action="register",
  title="Main method — seed 42",
  code_commit="abc123",
  environment={
    platform: "inspire",
    gpu: "A100-80GB x4",
    image: "docker.sii.shaipower.online/inspire-studio/myproject:v1"
  },
  hyperparameters={...})
```

The experiment's `code_commit` + `uv.lock` together enable full reproducibility:
- `code_commit` → exact code version
- `uv.lock` → exact Python package versions
- `environment.image` → exact system-level environment

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `uv: command not found` | `pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| `ModuleNotFoundError` in experiment | Check deps in `pyproject.toml`. Rebuild image with `uv sync --extra train --frozen` |
| matplotlib import error in scripts | `uv sync` (installs core deps including matplotlib) |
| Different results across machines | Check `uv.lock` is committed and identical. `uv sync --frozen` to use exact lock. |
| Image too large | Use slim base image. Only install `--extra train`, not all optional deps. Multi-stage Docker build. |
| Docker build fails (cgroup permission error) | Use buildah: `buildah bud --isolation chroot -t image:tag -f Dockerfile .` |
| Docker build fails (other errors) | Check Dockerfile syntax, disk space (`df -h`), base image availability. See `references/inspire-compute.md` |
| Image not found when submitting | Image was pushed to Harbor but not registered on the platform. Go to 镜像管理 → 新建镜像 |
